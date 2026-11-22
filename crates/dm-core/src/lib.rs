//! `dm-core` — a segmented, resumable, multi-connection HTTP download engine.
//!
//! ```no_run
//! # async fn demo() -> dm_core::Result<()> {
//! use dm_core::{Engine, EngineSettings, NewDownload};
//! let engine = Engine::in_memory(EngineSettings::default())?;
//! let mut events = engine.subscribe();
//! engine.add(NewDownload { url: "https://example.com/big.iso".into(), ..Default::default() })?;
//! while let Ok(event) = events.recv().await { println!("{event:?}"); }
//! # Ok(()) }
//! ```

mod engine;
mod error;
mod hls;
mod http;
mod media;
pub mod naming;
mod planner;
mod rate_limit;
mod storage;
mod store;
mod transfer;
mod types;

pub use engine::Engine;
pub use error::{Error, Result};
pub use media::{MediaTools, DEFAULT_QUALITY as DEFAULT_MEDIA_QUALITY};
pub use planner::plan_segments;
pub use types::*;
