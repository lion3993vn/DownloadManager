//! dm-cli <URL> [-c CONNECTIONS] [-o DIR] [-l KB_PER_SEC]

use dm_core::{Engine, EngineEvent, EngineSettings, NewDownload, Status};
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

const USAGE: &str = "usage: dm-cli <URL> [-c CONNECTIONS] [-o OUTPUT_DIR] [-l LIMIT_KB_PER_SEC]";

struct Args {
    url: String,
    connections: u32,
    out_dir: PathBuf,
    limit_kbps: u64,
}

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let mut url = None;
    let mut args = Args {
        url: String::new(),
        connections: 8,
        out_dir: std::env::current_dir().map_err(|e| e.to_string())?,
        limit_kbps: 0,
    };
    while let Some(a) = it.next() {
        let mut value = |name: &str| it.next().ok_or(format!("missing value for {name}"));
        match a.as_str() {
            "-c" | "--connections" => {
                args.connections = value("-c")?.parse().map_err(|_| "invalid -c")?
            }
            "-o" | "--output" => args.out_dir = PathBuf::from(value("-o")?),
            "-l" | "--limit" => args.limit_kbps = value("-l")?.parse().map_err(|_| "invalid -l")?,
            "-h" | "--help" => return Err(USAGE.into()),
            _ if url.is_none() && !a.starts_with('-') => url = Some(a),
            _ => return Err(format!("unexpected argument '{a}'\n{USAGE}")),
        }
    }
    args.url = url.ok_or(USAGE)?;
    Ok(args)
}

fn human(bytes: f64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    format!("{v:.1} {}", UNITS[i])
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let settings = EngineSettings {
        download_dir: args.out_dir.clone(),
        connections: args.connections,
        speed_limit: args.limit_kbps * 1024,
        ..Default::default()
    };
    let engine = match Engine::in_memory(settings) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };
    let mut events = engine.subscribe();
    let started = Instant::now();
    let id = match engine.add(NewDownload {
        url: args.url,
        ..Default::default()
    }) {
        Ok(d) => d.id,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };

    let ctrl_c = tokio::signal::ctrl_c();
    tokio::pin!(ctrl_c);
    loop {
        let event = tokio::select! {
            _ = &mut ctrl_c => {
                eprintln!("\ninterrupted");
                engine.shutdown().await;
                return ExitCode::from(130);
            }
            ev = events.recv() => match ev {
                Ok(ev) => ev,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return ExitCode::FAILURE,
            },
        };
        match event {
            EngineEvent::Progress { progress: p } if p.id == id => {
                let pct = p
                    .total_size
                    .map(|t| p.downloaded as f64 * 100.0 / t.max(1) as f64);
                print!(
                    "\r{:>6}  {} / {}  {}/s  conns: {:<2}  eta: {}      ",
                    pct.map_or("?".into(), |p| format!("{p:.1}%")),
                    human(p.downloaded as f64),
                    p.total_size.map_or("?".into(), |t| human(t as f64)),
                    human(p.speed),
                    p.active_connections,
                    p.eta_secs.map_or("-".into(), |s| format!("{s}s")),
                );
                let _ = std::io::stdout().flush();
            }
            EngineEvent::Updated { download: d } if d.id == id => match d.status {
                Status::Completed => {
                    let secs = started.elapsed().as_secs_f64();
                    let size = d.total_size.unwrap_or(d.downloaded) as f64;
                    println!(
                        "\ndone: {} ({}) in {:.2}s, avg {}/s",
                        d.file_path().display(),
                        human(size),
                        secs,
                        human(size / secs.max(0.001))
                    );
                    return ExitCode::SUCCESS;
                }
                Status::Failed => {
                    eprintln!("\nfailed: {}", d.error.unwrap_or_default());
                    return ExitCode::FAILURE;
                }
                Status::Downloading if d.total_size.is_some() => {
                    println!(
                        "{} — {} — {}",
                        d.file_name,
                        human(d.total_size.unwrap_or(0) as f64),
                        if d.resumable {
                            format!("{} segments, resumable", d.segments.len())
                        } else {
                            "single connection (no range support)".into()
                        }
                    );
                }
                _ => {}
            },
            _ => {}
        }
    }
}
