mod common;

use common::*;
use dm_core::{DownloadKind, Engine, EngineEvent, NewDownload, Status};

const MB: usize = 1024 * 1024;

fn add(engine: &Engine, url: String) -> dm_core::DownloadInfo {
    engine
        .add(NewDownload {
            url,
            ..Default::default()
        })
        .unwrap()
}

fn assert_no_leftovers(d: &dm_core::DownloadInfo) {
    let part = d.part_path();
    let mut dir = part.as_os_str().to_owned();
    dir.push(".d");
    assert!(!part.exists(), "part file left behind");
    assert!(
        !std::path::Path::new(&dir).exists(),
        "segment folder left behind"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn media_playlist_is_joined_byte_exact() {
    let server = start(3 * MB + 77).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let added = add(&engine, server.url("hls/media.m3u8"));
    assert_eq!(added.kind, DownloadKind::Hls);
    assert_eq!(added.file_name, "media.ts");

    let d = wait_done(&engine, &mut events, added.id).await;
    assert_eq!(d.file_name, "media.ts");
    assert_eq!(d.total_size, Some(server.hls_data().len() as u64));
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.hls_data());
    assert_no_leftovers(&d);
}

#[tokio::test(flavor = "multi_thread")]
async fn master_playlist_uses_best_variant() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let added = engine
        .add(NewDownload {
            url: server.url("hls/master.m3u8"),
            file_name: Some("Phim hay".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(added.file_name, "Phim hay.ts");

    // `low.m3u8` does not exist: picking it would fail the download.
    let d = wait_done(&engine, &mut events, added.id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.hls_data());
}

#[tokio::test(flavor = "multi_thread")]
async fn aes128_segments_are_decrypted() {
    let server = start(2 * MB + 5).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("hls/enc.m3u8")).id;

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.hls_data());
}

#[tokio::test(flavor = "multi_thread")]
async fn fmp4_gets_init_section_and_mp4_name() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("hls/fmp4.m3u8")).id;

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(d.file_name, "fmp4.mp4");
    let mut expected = server.hls_init().to_vec();
    expected.extend_from_slice(server.hls_data());
    assert_eq!(std::fs::read(d.file_path()).unwrap(), expected);
    assert_no_leftovers(&d);
}

#[tokio::test(flavor = "multi_thread")]
async fn byte_range_segments() {
    let server = start(MB + 333).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("hls/range.m3u8")).id;

    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.hls_data());
}

#[tokio::test(flavor = "multi_thread")]
async fn playlist_without_extension_is_detected() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let added = add(&engine, server.url("hls/noext"));
    // Check the kind in the `Added` event: `add` returns a fresh snapshot, and
    // the transfer may already have probed the URL and switched it to HLS.
    match events.recv().await.unwrap() {
        EngineEvent::Added { download } => assert_eq!(download.kind, DownloadKind::File),
        e => panic!("expected Added first, got {e:?}"),
    }

    let d = wait_done(&engine, &mut events, added.id).await;
    assert_eq!(d.kind, DownloadKind::Hls);
    assert_eq!(d.file_name, "noext.ts");
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.hls_data());
}

#[tokio::test(flavor = "multi_thread")]
async fn probe_describes_stream() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let p = engine
        .probe(&server.url("hls/master.m3u8"), &Default::default())
        .await
        .unwrap();
    let s = p.stream.expect("stream info");
    assert_eq!(s.segments, 12);
    assert_eq!(s.resolution, Some((1280, 720)));
    assert!((s.duration_secs - 48.0).abs() < 1e-9);
    assert_eq!(s.estimated_size, Some(2_000_000 * 48 / 8));
    assert!(!s.live);
    assert_eq!(p.file_name, "master.ts");

    let plain = engine
        .probe(&server.url("file"), &Default::default())
        .await
        .unwrap();
    assert!(plain.stream.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn live_stream_fails_cleanly() {
    let server = start(MB).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::in_memory(settings(dir.path())).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("hls/live.m3u8")).id;

    let d = wait_for(&engine, &mut events, id, |d| d.status == Status::Failed).await;
    assert!(d.error.unwrap().contains("live"));
    assert_eq!(server.hls_segment_requests(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_and_resume_keeps_finished_segments() {
    let server = start(2 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let mut s = settings(dir.path());
    s.connections = 2;
    let engine = Engine::in_memory(s).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("hls/slow.m3u8")).id;

    wait_for(&engine, &mut events, id, |d| d.downloaded > 0).await;
    engine.pause(id).unwrap();
    wait_idle(&engine, id).await;
    let paused = engine.get(id).unwrap();
    assert_eq!(paused.status, Status::Paused);
    assert!(paused.resumable);
    let requests_before = server.hls_segment_requests();
    assert!(requests_before < 12, "paused too late to test resuming");

    engine.resume(id).unwrap();
    let d = wait_done(&engine, &mut events, id).await;
    assert_eq!(std::fs::read(d.file_path()).unwrap(), server.hls_data());
    // Finished segments were kept: fewer than 12 new requests after resuming.
    assert!(server.hls_segment_requests() - requests_before < 12);
    assert_no_leftovers(&d);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_removes_segment_folder() {
    let server = start(2 * MB).await;
    let dir = tempfile::tempdir().unwrap();
    let mut s = settings(dir.path());
    s.connections = 2;
    let engine = Engine::in_memory(s).unwrap();
    let mut events = engine.subscribe();
    let id = add(&engine, server.url("hls/slow.m3u8")).id;

    wait_for(&engine, &mut events, id, |d| d.downloaded > 0).await;
    engine.cancel(id).unwrap();
    wait_idle(&engine, id).await;
    let d = engine.get(id).unwrap();
    assert_eq!(d.status, Status::Canceled);
    assert_no_leftovers(&d);
}
