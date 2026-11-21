//! Public engine: owns the download list, the queue and the running tasks.

use crate::error::{Error, Result};
use crate::http;
use crate::naming;
use crate::rate_limit::RateLimiter;
use crate::store::Store;
use crate::transfer::{self, Outcome};
use crate::types::*;
use futures_util::FutureExt;
use std::collections::{BTreeMap, HashMap};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

const SETTINGS_KEY: &str = "engine_settings";

/// Cheap to clone handle to the download engine.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub(crate) client: reqwest::Client,
    pub(crate) limiter: RateLimiter,
    store: Store,
    settings: RwLock<EngineSettings>,
    events: broadcast::Sender<EngineEvent>,
    state: Mutex<State>,
    rt: Handle,
    shutting_down: AtomicBool,
}

#[derive(Default)]
struct State {
    /// Ordered by id, which is also the queue order.
    downloads: BTreeMap<DownloadId, DownloadInfo>,
    running: HashMap<DownloadId, CancellationToken>,
    /// Part files of downloads removed while their task was still running.
    orphaned_parts: HashMap<DownloadId, PathBuf>,
}

impl Engine {
    /// Open (or create) the database at `db_path` and restore previous downloads.
    /// Must be called from within a Tokio runtime.
    pub fn open(db_path: &Path) -> Result<Engine> {
        let store = Store::open(db_path)?;
        let settings = store
            .get_kv(SETTINGS_KEY)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self::build(store, settings)
    }

    /// Non-persistent engine (CLI, tests). Must be called from within a Tokio runtime.
    pub fn in_memory(settings: EngineSettings) -> Result<Engine> {
        Self::build(Store::open_in_memory()?, settings)
    }

    fn build(store: Store, settings: EngineSettings) -> Result<Engine> {
        let mut downloads = BTreeMap::new();
        for mut d in store.load_all()? {
            // Interrupted by a crash or shutdown: put back in the queue.
            if d.status == Status::Downloading {
                d.status = Status::Queued;
                store.save(&d)?;
            }
            downloads.insert(d.id, d);
        }
        let (events, _) = broadcast::channel(1024);
        let inner = Arc::new(Inner {
            client: http::build_client()?,
            limiter: RateLimiter::new(settings.speed_limit),
            store,
            settings: RwLock::new(settings),
            events,
            state: Mutex::new(State {
                downloads,
                ..Default::default()
            }),
            rt: Handle::try_current().map_err(|_| {
                Error::Other("Engine must be created inside a Tokio runtime".into())
            })?,
            shutting_down: AtomicBool::new(false),
        });
        inner.schedule();
        Ok(Engine { inner })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.inner.events.subscribe()
    }

    pub fn list(&self) -> Vec<DownloadInfo> {
        self.inner
            .state
            .lock()
            .unwrap()
            .downloads
            .values()
            .cloned()
            .collect()
    }

    pub fn get(&self, id: DownloadId) -> Option<DownloadInfo> {
        self.inner.state.lock().unwrap().downloads.get(&id).cloned()
    }

    /// Whether a transfer task for `id` is still alive (it may be stopping).
    pub fn is_running(&self, id: DownloadId) -> bool {
        self.inner.state.lock().unwrap().running.contains_key(&id)
    }

    pub fn settings(&self) -> EngineSettings {
        self.inner.settings()
    }

    pub fn update_settings(&self, mut settings: EngineSettings) -> Result<()> {
        settings.connections = settings.connections.clamp(1, MAX_CONNECTIONS);
        settings.max_concurrent = settings.max_concurrent.max(1);
        settings.min_segment_size = settings.min_segment_size.max(64 * 1024);
        self.inner.store.set_kv(
            SETTINGS_KEY,
            &serde_json::to_string(&settings).expect("serializable"),
        )?;
        self.inner.limiter.set_rate(settings.speed_limit);
        *self.inner.settings.write().unwrap() = settings;
        self.inner.schedule();
        Ok(())
    }

    /// Generic key/value storage for the host application.
    pub fn get_kv(&self, key: &str) -> Result<Option<String>> {
        self.inner.store.get_kv(key)
    }

    pub fn set_kv(&self, key: &str, value: &str) -> Result<()> {
        self.inner.store.set_kv(key, value)
    }

    /// Inspect a URL (size, name, range support) without downloading it.
    pub async fn probe(&self, url: &str, headers: &RequestHeaders) -> Result<ProbeResult> {
        http::probe(&self.inner.client, url, headers).await
    }

    pub fn add(&self, req: NewDownload) -> Result<DownloadInfo> {
        http::validate_url(&req.url)?;
        let settings = self.settings();
        let save_dir = req
            .save_dir
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(settings.download_dir);
        let auto_name = req.file_name.as_deref().is_none_or(|n| n.trim().is_empty());
        let wanted = match req.file_name.as_deref() {
            Some(n) if !auto_name => naming::sanitize(n),
            _ => naming::name_from_url(&req.url),
        };
        let mut info = DownloadInfo {
            id: 0,
            url: req.url,
            file_name: wanted,
            save_dir,
            total_size: None,
            downloaded: 0,
            status: if req.start_paused {
                Status::Paused
            } else {
                Status::Queued
            },
            error: None,
            resumable: false,
            connections: req
                .connections
                .unwrap_or(settings.connections)
                .clamp(1, MAX_CONNECTIONS),
            created_at: now_ms(),
            completed_at: None,
            segments: Vec::new(),
            headers: req.headers,
            etag: None,
            last_modified: None,
            auto_name,
        };
        {
            let mut st = self.inner.state.lock().unwrap();
            info.file_name = unique_in(&st, None, &info.save_dir, &info.file_name);
            info.id = self.inner.store.insert(&info)?;
            st.downloads.insert(info.id, info.clone());
        }
        self.inner.emit(EngineEvent::Added {
            download: info.clone(),
        });
        self.inner.schedule();
        Ok(self.get(info.id).unwrap_or(info))
    }

    pub fn pause(&self, id: DownloadId) -> Result<()> {
        self.inner.transition(id, |d, running| {
            if matches!(d.status, Status::Queued | Status::Downloading) {
                d.status = Status::Paused;
                if let Some(token) = running {
                    token.cancel();
                }
            }
        })
    }

    pub fn resume(&self, id: DownloadId) -> Result<()> {
        self.inner.transition(id, |d, _| {
            if matches!(d.status, Status::Paused | Status::Failed | Status::Canceled) {
                d.status = Status::Queued;
                d.error = None;
            }
        })?;
        self.inner.schedule();
        Ok(())
    }

    /// Stop and discard the partial data (the entry stays in the list).
    pub fn cancel(&self, id: DownloadId) -> Result<()> {
        let mut delete_now = None;
        self.inner.transition(id, |d, running| {
            if d.status == Status::Completed {
                return;
            }
            d.status = Status::Canceled;
            d.error = None;
            match running {
                // The task deletes the part file once it has closed it.
                Some(token) => token.cancel(),
                None => {
                    delete_now = Some(d.part_path());
                    d.segments.clear();
                    d.downloaded = 0;
                }
            }
        })?;
        if let Some(p) = delete_now {
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    }

    /// Remove from the list. `delete_file` also deletes a completed file from disk.
    pub fn remove(&self, id: DownloadId, delete_file: bool) -> Result<()> {
        let info = {
            let mut st = self.inner.state.lock().unwrap();
            let info = st.downloads.remove(&id).ok_or(Error::NotFound(id))?;
            if let Some(token) = st.running.get(&id) {
                token.cancel();
                st.orphaned_parts.insert(id, info.part_path());
            } else {
                let _ = std::fs::remove_file(info.part_path());
            }
            info
        };
        if delete_file && info.status == Status::Completed {
            let _ = std::fs::remove_file(info.file_path());
        }
        self.inner.store.delete(id)?;
        self.inner.emit(EngineEvent::Removed { id });
        self.inner.schedule();
        Ok(())
    }

    pub fn pause_all(&self) {
        for d in self.list() {
            let _ = self.pause(d.id);
        }
    }

    pub fn resume_all(&self) {
        for d in self.list() {
            if d.status == Status::Paused {
                let _ = self.resume(d.id);
            }
        }
    }

    /// Stop all transfers, persisting their progress. Interrupted downloads
    /// resume automatically the next time the engine is opened.
    pub async fn shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::SeqCst);
        {
            let st = self.inner.state.lock().unwrap();
            st.running.values().for_each(CancellationToken::cancel);
        }
        for _ in 0..100 {
            if self.inner.state.lock().unwrap().running.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

impl Inner {
    pub(crate) fn settings(&self) -> EngineSettings {
        self.settings.read().unwrap().clone()
    }

    pub(crate) fn snapshot(&self, id: DownloadId) -> Result<DownloadInfo> {
        self.get_cloned(id).ok_or(Error::NotFound(id))
    }

    fn get_cloned(&self, id: DownloadId) -> Option<DownloadInfo> {
        self.state.lock().unwrap().downloads.get(&id).cloned()
    }

    fn emit(&self, event: EngineEvent) {
        // No receivers is fine.
        let _ = self.events.send(event);
    }

    pub(crate) fn emit_progress(&self, progress: Progress) {
        self.emit(EngineEvent::Progress { progress });
    }

    pub(crate) fn unique_name(&self, id: DownloadId, dir: &Path, name: &str) -> String {
        unique_in(&self.state.lock().unwrap(), Some(id), dir, name)
    }

    /// Store the fields owned by the transfer (never the status, which the
    /// user may change concurrently) and announce the change.
    pub(crate) fn commit(&self, info: &DownloadInfo) {
        if let Some(d) = self.merge_transfer_fields(info) {
            self.emit(EngineEvent::Updated { download: d });
        }
    }

    /// Like [`commit`] but without an event (periodic progress checkpoints).
    pub(crate) fn commit_quiet(&self, info: &DownloadInfo) {
        self.merge_transfer_fields(info);
    }

    fn merge_transfer_fields(&self, info: &DownloadInfo) -> Option<DownloadInfo> {
        let mut st = self.state.lock().unwrap();
        let d = st.downloads.get_mut(&info.id)?;
        d.file_name.clone_from(&info.file_name);
        d.total_size = info.total_size;
        d.downloaded = info.downloaded;
        d.resumable = info.resumable;
        d.segments.clone_from(&info.segments);
        d.etag.clone_from(&info.etag);
        d.last_modified.clone_from(&info.last_modified);
        d.auto_name = info.auto_name;
        if let Err(e) = self.store.save(d) {
            tracing::error!(error = %e, "failed to persist download");
        }
        Some(d.clone())
    }

    /// Apply a user-driven state change under the lock, persist and announce it.
    fn transition(
        &self,
        id: DownloadId,
        f: impl FnOnce(&mut DownloadInfo, Option<&CancellationToken>),
    ) -> Result<()> {
        let updated = {
            let mut st = self.state.lock().unwrap();
            let State {
                downloads, running, ..
            } = &mut *st;
            let d = downloads.get_mut(&id).ok_or(Error::NotFound(id))?;
            f(d, running.get(&id));
            self.store.save(d)?;
            d.clone()
        };
        self.emit(EngineEvent::Updated { download: updated });
        Ok(())
    }

    /// Start queued downloads while there are free slots.
    fn schedule(self: &Arc<Self>) {
        if self.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let max = self.settings().max_concurrent.max(1) as usize;
        let mut started = Vec::new();
        {
            let mut st = self.state.lock().unwrap();
            while st.running.len() < max {
                let next = st
                    .downloads
                    .values()
                    .find(|d| d.status == Status::Queued && !st.running.contains_key(&d.id))
                    .map(|d| d.id);
                let Some(id) = next else { break };
                let token = CancellationToken::new();
                st.running.insert(id, token.clone());
                let d = st.downloads.get_mut(&id).expect("exists");
                d.status = Status::Downloading;
                d.error = None;
                if let Err(e) = self.store.save(d) {
                    tracing::error!(error = %e, "failed to persist download");
                }
                started.push((d.clone(), token));
            }
        }
        for (download, token) in started {
            let id = download.id;
            self.emit(EngineEvent::Updated { download });
            let inner = self.clone();
            self.rt
                .spawn(async move { inner.run_task(id, token).await });
        }
    }

    async fn run_task(self: Arc<Self>, id: DownloadId, token: CancellationToken) {
        let result = AssertUnwindSafe(transfer::run(self.clone(), id, token))
            .catch_unwind()
            .await
            .unwrap_or_else(|_| Err(Error::Other("download task panicked".into())));

        let mut delete_part;
        let updated = {
            let mut st = self.state.lock().unwrap();
            st.running.remove(&id);
            delete_part = st.orphaned_parts.remove(&id);
            let shutting_down = self.shutting_down.load(Ordering::SeqCst);
            st.downloads.get_mut(&id).map(|d| {
                match &result {
                    Ok(Outcome::Completed) => {
                        d.status = Status::Completed;
                        d.error = None;
                        d.completed_at = Some(now_ms());
                    }
                    // Keep "downloading" on shutdown so it auto-resumes next start.
                    Ok(Outcome::Stopped) if d.status == Status::Downloading && !shutting_down => {
                        d.status = Status::Paused;
                    }
                    Err(e) if d.status == Status::Downloading && !shutting_down => {
                        tracing::warn!(id, error = %e, "download failed");
                        d.status = Status::Failed;
                        d.error = Some(e.to_string());
                    }
                    _ => {}
                }
                if d.status == Status::Canceled {
                    delete_part = Some(d.part_path());
                    d.segments.clear();
                    d.downloaded = 0;
                }
                if let Err(e) = self.store.save(d) {
                    tracing::error!(error = %e, "failed to persist download");
                }
                d.clone()
            })
        };
        if let Some(p) = delete_part {
            let _ = tokio::fs::remove_file(p).await;
        }
        if let Some(download) = updated {
            self.emit(EngineEvent::Updated { download });
        }
        self.schedule();
    }
}

fn unique_in(st: &State, exclude: Option<DownloadId>, dir: &Path, name: &str) -> String {
    naming::unique_name(dir, name, |candidate| {
        st.downloads.values().any(|d| {
            Some(d.id) != exclude
                && d.status != Status::Completed
                && d.save_dir == dir
                && d.file_name == candidate
        })
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
