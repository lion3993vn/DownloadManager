//! Download schedule (setting `schedule`): at the start time, resume every
//! paused download ("Add, start later" adds paused ones); at the optional stop
//! time, pause everything. Local time, on the chosen days of the week.
//!
//! A tick every 15 s fires the times that fell between the previous tick and
//! now, so a busy or briefly suspended machine still fires them once (late).
//! The app has to be running: "start with the system" keeps it in the tray.

use crate::state::AppState;
use chrono::{Datelike, Duration as Days, Local, NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const TICK: Duration = Duration::from_secs(15);
/// A machine asleep longer than this does not get a stale start on waking.
const MAX_CATCH_UP_MINUTES: i64 = 30;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedule {
    pub enabled: bool,
    /// "HH:MM", local time.
    pub start: String,
    pub stop_enabled: bool,
    /// "HH:MM", local time.
    pub stop: String,
    /// Days it runs on: 0 = Monday … 6 = Sunday.
    pub days: Vec<u8>,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: false,
            start: "02:00".into(),
            stop_enabled: false,
            stop: "07:00".into(),
            days: (0..7).collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Start,
    Stop,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Fired {
    action: Action,
    /// Downloads resumed or paused.
    count: usize,
}

fn parse_time(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

/// Scheduled times in `(prev, now]`, oldest first.
pub fn due(prev: NaiveDateTime, now: NaiveDateTime, s: &Schedule) -> Vec<Action> {
    if !s.enabled || now <= prev {
        return Vec::new();
    }
    let prev = prev.max(now - Days::minutes(MAX_CATCH_UP_MINUTES));
    let mut events: Vec<(NaiveDateTime, Action)> = Vec::new();
    let mut day: NaiveDate = prev.date();
    while day <= now.date() {
        if s.days
            .contains(&(day.weekday().num_days_from_monday() as u8))
        {
            if let Some(t) = parse_time(&s.start) {
                events.push((day.and_time(t), Action::Start));
            }
            if let Some(t) = parse_time(&s.stop).filter(|_| s.stop_enabled) {
                events.push((day.and_time(t), Action::Stop));
            }
        }
        day += Days::days(1);
    }
    events.sort_by_key(|(at, _)| *at);
    events
        .into_iter()
        .filter(|(at, _)| *at > prev && *at <= now)
        .map(|(_, a)| a)
        .collect()
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut prev = Local::now().naive_local();
        loop {
            tokio::time::sleep(TICK).await;
            let now = Local::now().naive_local();
            let Some(state) = app.try_state::<AppState>() else {
                prev = now;
                continue;
            };
            let schedule = state.app_settings().schedule;
            for action in due(prev, now, &schedule) {
                run(&app, &state, action);
            }
            prev = now;
        }
    });
}

fn run(app: &AppHandle, state: &AppState, action: Action) {
    use dm_core::Status;
    let list = state.engine.list();
    let count = match action {
        Action::Start => {
            let n = list.iter().filter(|d| d.status == Status::Paused).count();
            state.engine.resume_all();
            n
        }
        Action::Stop => {
            let n = list
                .iter()
                .filter(|d| matches!(d.status, Status::Downloading | Status::Queued))
                .count();
            state.engine.pause_all();
            n
        }
    };
    tracing::info!(?action, count, "schedule fired");
    let _ = app.emit("dm://schedule", Fired { action, count });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(d: u32, hm: &str) -> NaiveDateTime {
        // 2026-11-23 is a Monday.
        NaiveDate::from_ymd_opt(2026, 11, d)
            .unwrap()
            .and_time(parse_time(hm).unwrap())
    }

    fn schedule() -> Schedule {
        Schedule {
            enabled: true,
            start: "02:00".into(),
            stop_enabled: true,
            stop: "07:00".into(),
            days: (0..7).collect(),
        }
    }

    #[test]
    fn fires_once_when_the_time_passes() {
        let s = schedule();
        assert_eq!(due(at(23, "01:59"), at(23, "02:00"), &s), [Action::Start]);
        assert!(due(at(23, "02:00"), at(23, "02:01"), &s).is_empty());
        assert_eq!(due(at(23, "06:59"), at(23, "07:00"), &s), [Action::Stop]);
        // Midnight crossing.
        let mut late = schedule();
        late.start = "00:00".into();
        assert_eq!(
            due(at(23, "23:59"), at(24, "00:00"), &late),
            [Action::Start]
        );
    }

    #[test]
    fn respects_days_switches_and_catch_up() {
        let mut s = schedule();
        s.days = vec![1]; // Tuesday only
        assert!(due(at(23, "01:59"), at(23, "02:01"), &s).is_empty());
        assert_eq!(due(at(24, "01:59"), at(24, "02:01"), &s), [Action::Start]);
        let mut off = schedule();
        off.enabled = false;
        assert!(due(at(23, "01:59"), at(23, "02:01"), &off).is_empty());
        let mut no_stop = schedule();
        no_stop.stop_enabled = false;
        assert!(due(at(23, "06:59"), at(23, "07:01"), &no_stop).is_empty());
        // Woke up 10 minutes late: still fires; 3 hours late: skipped.
        assert_eq!(
            due(at(23, "01:55"), at(23, "02:10"), &schedule()),
            [Action::Start]
        );
        assert!(due(at(23, "01:00"), at(23, "05:00"), &schedule()).is_empty());
        // Bad time strings are ignored.
        let mut bad = schedule();
        bad.start = "25:99".into();
        assert!(due(at(23, "01:59"), at(23, "02:01"), &bad).is_empty());
    }
}
