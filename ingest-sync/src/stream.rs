//! Per-stream timestamp buffer.
//!
//! Each stream has an independent ring buffer of timestamped MPEG-TS chunks.
//! The buffer accumulates incoming data and releases it only when the release
//! deadline has passed, implementing the variable-delay hold needed for
//! multi-camera synchronisation.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use bytes::Bytes;
use log::debug;

use crate::pcr::{pcr_to_ns, scan_for_pcr, unwrap_pcr_ns, PCR_WRAP_NS};

/// A chunk of MPEG-TS data with its associated timing metadata.
struct BufferedChunk {
    data: Bytes,
    /// Wall-clock arrival time.
    arrival: Instant,
    /// Absolute wall-clock capture time derived from PCR (ns since epoch).
    /// `None` if no PCR has been decoded for this chunk yet.
    capture_ns: Option<u64>,
    /// Wall-clock time at which this chunk should be forwarded downstream.
    release_at: Instant,
}

/// Smoothed estimate of a stream's one-way latency (arrival_wall − pcr_wall).
/// Updated with an exponential moving average each time a PCR is seen.
#[derive(Debug, Clone, Copy)]
pub struct LatencyEstimate {
    /// Smoothed latency in nanoseconds.  `None` until the first PCR.
    pub latency_ns: Option<i64>,
    /// EMA smoothing factor (0 < α ≤ 1).  Lower = smoother but slower to adapt.
    alpha: f64,
}

impl LatencyEstimate {
    pub fn new(alpha: f64) -> Self {
        Self { latency_ns: None, alpha }
    }

    /// Update with a new sample (ns).
    pub fn update(&mut self, sample_ns: i64) {
        self.latency_ns = Some(match self.latency_ns {
            None => sample_ns,
            Some(prev) => {
                let delta = sample_ns as f64 - prev as f64;
                prev + (self.alpha * delta) as i64
            }
        });
    }
}

/// Per-stream state: buffer + latency estimate.
pub struct StreamBuffer {
    id: String,
    queue: VecDeque<BufferedChunk>,
    pub latency: LatencyEstimate,
    /// The current hold duration for this stream (recomputed by the coordinator).
    pub hold: Duration,
    /// Wall-clock ns reference epoch (`std::time::UNIX_EPOCH` → `Instant` mapping).
    epoch_instant: Instant,
    epoch_wall_ns: u64,
}

impl StreamBuffer {
    pub fn new(id: &str) -> Self {
        let epoch_instant = Instant::now();
        let epoch_wall_ns = {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64
        };
        Self {
            id: id.to_string(),
            queue: VecDeque::new(),
            latency: LatencyEstimate::new(0.05),
            hold: Duration::ZERO,
            epoch_instant,
            epoch_wall_ns,
        }
    }

    /// Approximate wall-clock time as ns since Unix epoch.
    #[inline]
    fn wall_now_ns(&self) -> u64 {
        self.epoch_wall_ns + self.epoch_instant.elapsed().as_nanos() as u64
    }

    /// Approximate `Instant` for a given wall-clock ns value.
    #[inline]
    fn instant_for_ns(&self, wall_ns: u64) -> Instant {
        let delta = wall_ns.saturating_sub(self.epoch_wall_ns);
        self.epoch_instant + Duration::from_nanos(delta)
    }

    /// Push an incoming MPEG-TS buffer into the queue.
    ///
    /// * Scans for the first PCR in the data.
    /// * Updates the latency estimate.
    /// * Sets `release_at` = arrival + current `hold`.
    pub fn push(&mut self, data: Bytes) {
        let arrival = Instant::now();
        let wall_ns = self.wall_now_ns();

        let capture_ns = scan_for_pcr(&data).map(|(pcr_val, _)| {
            let pcr_ns = pcr_to_ns(pcr_val);
            let abs_ns = unwrap_pcr_ns(pcr_ns, wall_ns);

            // Update latency estimate: how long did this frame take to arrive?
            // Clamp to ±PCR_WRAP_NS/2 to ignore stale/corrupt PCR values.
            let half_wrap = (PCR_WRAP_NS / 2) as i64;
            let sample = (wall_ns as i64) - (abs_ns as i64);
            if sample.abs() < half_wrap {
                self.latency.update(sample);
            }
            abs_ns
        });

        let release_at = arrival + self.hold;

        debug!(
            "[{}] buffered {} bytes  pcr={:?}ns  hold={:.0}ms",
            self.id,
            data.len(),
            capture_ns,
            self.hold.as_secs_f64() * 1000.0,
        );

        self.queue.push_back(BufferedChunk { data, arrival, capture_ns, release_at });
    }

    /// Drain all chunks whose `release_at` deadline has passed and return them.
    pub fn drain_ready(&mut self) -> Vec<Bytes> {
        let now = Instant::now();
        let mut out = Vec::new();
        while let Some(front) = self.queue.front() {
            if front.release_at <= now {
                out.push(self.queue.pop_front().unwrap().data);
            } else {
                break;
            }
        }
        out
    }

    /// Peek the oldest chunk's capture time (ns) without removing it.
    pub fn oldest_capture_ns(&self) -> Option<u64> {
        self.queue.front().and_then(|c| c.capture_ns)
    }

    /// Number of bytes held in the buffer (approximate).
    pub fn buffered_bytes(&self) -> usize {
        self.queue.iter().map(|c| c.data.len()).sum()
    }

    /// Drop all buffered chunks (e.g. on stream reconnect / offset reset).
    pub fn clear(&mut self) {
        self.queue.clear();
    }

    /// Update the epoch mapping so that `wall_now_ns()` stays accurate.
    /// Call periodically (e.g. every minute) to counter Instant drift.
    pub fn refresh_epoch(&mut self) {
        use std::time::{SystemTime, UNIX_EPOCH};
        self.epoch_instant = Instant::now();
        self.epoch_wall_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
    }
}
