//! Real yt-dlp downloads. Skipped unless `DM_YTDLP` (and optionally
//! `DM_FFMPEG`) point at the tools, because they need the network:
//!
//!   DM_YTDLP=…/yt-dlp.exe DM_FFMPEG=…/ffmpeg.exe cargo test -p dm-core --test media

mod common;

use common::*;
use dm_core::{DownloadKind, Engine, MediaTools, NewDownload, Status};

fn tools() -> Option<MediaTools> {
    Some(MediaTools {
        ytdlp: std::env::var_os("DM_YTDLP")?.into(),
        ffmpeg: std::env::var_os("DM_FFMPEG").map(Into::into),
    })
}

/// yt-dlp processes still alive (the standalone binary spawns a child).
fn ytdlp_processes() -> usize {
    #[cfg(windows)]
    {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq yt-dlp.exe", "/NH"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .matches("yt-dlp.exe")
            .count()
    }
    #[cfg(unix)]
    {
        let out = std::process::Command::new("pgrep")
            .args(["-f", "yt-dlp"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).lines().count()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn youtube_pause_stops_the_process_tree_and_resumes() {
    let Some(tools) = tools() else {
        eprintln!("skipped: set DM_YTDLP to run");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    engine.set_media_tools(Some(tools));
    let mut events = engine.subscribe();
    // Big Buck Bunny (10 min): big enough to pause in the middle.
    let added = engine
        .add(NewDownload {
            url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ".into(),
            media_quality: Some("360".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(added.kind, DownloadKind::Media);
    let id = added.id;

    wait_progress(&mut events, id, 2 * 1024 * 1024).await;
    engine.pause(id).unwrap();
    wait_idle(&engine, id).await;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    assert_eq!(ytdlp_processes(), 0, "pause left yt-dlp running");
    let paused = engine.get(id).unwrap();
    assert_eq!(paused.status, Status::Paused);
    assert!(paused.downloaded > 0);

    engine.resume(id).unwrap();
    let d = wait_done_within(&engine, &mut events, id, 600).await;
    assert!(d.file_name.ends_with(".mp4"), "{}", d.file_name);
    let size = std::fs::metadata(d.file_path()).unwrap().len();
    assert_eq!(d.total_size, Some(size));
    assert!(size > 5 * 1024 * 1024);
    assert_eq!(ytdlp_processes(), 0);
    // Work folder cleaned up.
    let mut work = d.part_path().into_os_string();
    work.push(".d");
    assert!(!std::path::Path::new(&work).exists());
}
