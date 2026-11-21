mod common;

use common::*;
use dm_core::{Engine, EngineSettings, NewDownload, Status};

const MB: usize = 1024 * 1024;

fn add(engine: &Engine, url: String) -> i64 {
    engine
        .add(NewDownload {
            url,
            ..Default::default()
        })
        .unwrap()
        .id
}

#[tokio::test(flavor = "multi_thread")]
async fn segmented_download_is_byte_exact() {
    let server = start(5 * MB + 123).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("file"));

    let d = wait_done(&engine, &mut events, id).await;
    assert!(d.resumable);
    assert_eq!(d.total_size, Some(server.data().len() as u64));
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
    assert!(
        server.range_requests() >= 8,
        "expected parallel range requests"
    );
    assert!(!d.part_path().exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn server_without_ranges_uses_single_stream() {
    let server = start(2 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("norange"));

    let d = wait_done(&engine, &mut events, id).await;
    assert!(!d.resumable);
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn server_rejecting_range_header_falls_back() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("rangeforbidden"));

    let d = wait_done(&engine, &mut events, id).await;
    assert!(!d.resumable);
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn unknown_size_chunked_response() {
    let server = start(MB + 7).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("chunked"));

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(d.total_size, Some(server.data().len() as u64));
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn flaky_connections_are_retried() {
    let server = start(4 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(EngineSettings {
        connections: 4,
        ..settings(dir.path())
    })
    .unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("flaky"));

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_and_resume() {
    let server = start(6 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("slow"));

    wait_progress(&mut events, id, MB as u64).await;
    engine.pause(id).unwrap();
    wait_idle(&engine, id).await;
    let paused = engine.get(id).unwrap();
    assert_eq!(paused.status, Status::Paused);
    assert!(paused.downloaded > 0 && paused.downloaded < server.data().len() as u64);
    assert!(paused.part_path().exists());

    engine.resume(id).unwrap();
    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn resumes_after_restart() {
    let server = start(6 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("state.db");
    let id;
    {
        let engine = Engine::open(&db).unwrap();
        engine.update_settings(settings(dir.path())).unwrap();
        let mut events = engine.subscribe();
        id = add(&engine, server.url("slow"));
        wait_progress(&mut events, id, MB as u64).await;
        engine.shutdown().await;
        let d = engine.get(id).unwrap();
        assert!(
            d.downloaded > 0,
            "progress should be checkpointed on shutdown"
        );
    }
    // A new engine on the same database picks the download up again.
    let engine = Engine::open(&db).unwrap();
    let mut events = engine.subscribe();
    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_change_restarts_from_zero() {
    let server = start(6 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    // "versioned" is fast, so throttle to be able to pause mid-way.
    engine
        .update_settings(EngineSettings {
            speed_limit: 2 * MB as u64,
            ..settings(dir.path())
        })
        .unwrap();
    let id = add(&engine, server.url("versioned"));
    wait_progress(&mut events, id, MB as u64).await;
    engine.pause(id).unwrap();
    wait_idle(&engine, id).await;

    reqwest_get(&server.url("bump")).await;
    engine.update_settings(settings(dir.path())).unwrap();
    engine.resume(id).unwrap();
    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data_v2());
}

#[tokio::test(flavor = "multi_thread")]
async fn uses_content_disposition_name_and_avoids_collisions() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("report final.bin"), b"existing").unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("attachment"));

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(d.file_name, "report final (1).bin");
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
    assert_eq!(
        std::fs::read(dir.path().join("report final.bin")).unwrap(),
        b"existing"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_removes_partial_file() {
    let server = start(6 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("slow"));
    wait_progress(&mut events, id, 512 * 1024).await;
    let part = engine.get(id).unwrap().part_path();
    assert!(part.exists());

    engine.cancel(id).unwrap();
    wait_idle(&engine, id).await;
    let d = engine.get(id).unwrap();
    assert_eq!(d.status, Status::Canceled);
    assert!(!part.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn http_errors_fail_the_download() {
    let server = start(1024).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("missing"));
    let d = wait_for(&engine, &mut events, id, |d| d.status == Status::Failed).await;
    assert!(d.error.unwrap().contains("404"));
}

#[tokio::test(flavor = "multi_thread")]
async fn queue_respects_max_concurrent() {
    let server = start(2 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(EngineSettings {
        max_concurrent: 1,
        ..settings(dir.path())
    })
    .unwrap();
    let mut events = engine.subscribe();
    let a = add(&engine, server.url("slow"));
    let b = add(&engine, server.url("slow"));
    assert_eq!(engine.get(b).unwrap().status, Status::Queued);
    let da = wait_done(&engine, &mut events, a).await;
    let db = wait_done(&engine, &mut events, b).await;
    assert_ne!(da.file_name, db.file_name);
    assert_eq!(std::fs::read(db.file_path()).unwrap(), server.data());
}

#[tokio::test(flavor = "multi_thread")]
async fn adapts_to_connection_limited_server() {
    let server = start(4 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("limited"));

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.data());
    assert!(
        server.rejected() > 0,
        "server should have throttled some connections"
    );
}

async fn reqwest_get(url: &str) {
    // Minimal HTTP/1.1 GET without pulling another client into dev-deps.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let u = url.strip_prefix("http://").unwrap();
    let (host, path) = u.split_once('/').unwrap();
    let mut s = tokio::net::TcpStream::connect(host).await.unwrap();
    s.write_all(
        format!("GET /{path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes(),
    )
    .await
    .unwrap();
    let mut out = Vec::new();
    s.read_to_end(&mut out).await.unwrap();
}
