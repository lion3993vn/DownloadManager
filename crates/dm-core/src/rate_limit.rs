//! Global token-bucket bandwidth limiter shared by every connection.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    /// Bytes per second, 0 = unlimited.
    rate: AtomicU64,
    bucket: Mutex<Bucket>,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    pub fn new(rate: u64) -> Self {
        Self {
            rate: AtomicU64::new(rate),
            bucket: Mutex::new(Bucket {
                tokens: rate as f64,
                last: Instant::now(),
            }),
        }
    }

    pub fn set_rate(&self, rate: u64) {
        self.rate.store(rate, Ordering::Relaxed);
        let mut b = self.bucket.lock().unwrap();
        b.tokens = b.tokens.min(rate as f64);
        b.last = Instant::now();
    }

    /// Consume `n` bytes worth of tokens, sleeping if the bucket went into debt.
    /// The bucket may go negative so that large chunks never deadlock.
    pub async fn acquire(&self, n: u64) {
        let rate = self.rate.load(Ordering::Relaxed);
        if rate == 0 || n == 0 {
            return;
        }
        let wait = {
            let mut b = self.bucket.lock().unwrap();
            let now = Instant::now();
            let refill = now.duration_since(b.last).as_secs_f64() * rate as f64;
            b.last = now;
            // Allow at most one second of burst.
            b.tokens = (b.tokens + refill).min(rate as f64) - n as f64;
            (b.tokens < 0.0).then(|| Duration::from_secs_f64(-b.tokens / rate as f64))
        };
        if let Some(wait) = wait {
            tokio::time::sleep(wait).await;
        }
    }
}
