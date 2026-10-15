//! Phase 9 scheduler logic that doesn't need the app: when a schedule
//! next fires, persisting tasks/history, and turning a task into a
//! transfer request. The runner itself lives in `commands::scheduler`.

use crate::models::scheduler::{
    Schedule, ScheduleFrequency, ScheduledTask, ScheduledTaskType, SchedulerData,
};
use crate::models::transfer::{CollisionPolicy, TransferMode, TransferOptions, TransferRequest};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone};
use std::fs;
use std::path::Path;

fn parse_time(time: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(time.trim(), "%H:%M").ok()
}

fn at(date: NaiveDate, time: NaiveTime) -> Option<DateTime<Local>> {
    let naive = date.and_time(time);
    // A time skipped by a DST change falls an hour later.
    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(naive + Duration::hours(1))).earliest())
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (y, m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(y, m, 1)
        .and_then(|d| d.pred_opt())
        .map_or(28, |d| d.day())
}

fn monthly(year: i32, month: u32, day: u32, time: NaiveTime) -> Option<DateTime<Local>> {
    let day = day.clamp(1, days_in_month(year, month));
    at(NaiveDate::from_ymd_opt(year, month, day)?, time)
}

/// The first time `schedule` fires strictly after `after`; `None` for a
/// one-off in the past, or an invalid schedule.
pub fn next_run(schedule: &Schedule, after: DateTime<Local>) -> Option<DateTime<Local>> {
    let time = parse_time(&schedule.time)?;
    let today = after.date_naive();
    match schedule.frequency {
        ScheduleFrequency::Once => {
            let date = NaiveDate::parse_from_str(schedule.date.trim(), "%Y-%m-%d").ok()?;
            at(date, time).filter(|t| *t > after)
        }
        ScheduleFrequency::Daily => {
            let t = at(today, time)?;
            if t > after { Some(t) } else { at(today.succ_opt()?, time) }
        }
        ScheduleFrequency::Weekly => {
            let target = schedule.weekday.min(6);
            let ahead = (target + 7 - today.weekday().num_days_from_monday()) % 7;
            let t = at(today + Duration::days(ahead as i64), time)?;
            if t > after { Some(t) } else { at(today + Duration::days(ahead as i64 + 7), time) }
        }
        ScheduleFrequency::Monthly => {
            let t = monthly(today.year(), today.month(), schedule.day_of_month, time)?;
            if t > after {
                return Some(t);
            }
            let (y, m) = if today.month() == 12 { (today.year() + 1, 1) } else { (today.year(), today.month() + 1) };
            monthly(y, m, schedule.day_of_month, time)
        }
    }
}

pub fn to_iso(t: DateTime<Local>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

pub fn parse_iso(s: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| t.with_timezone(&Local))
}

pub fn load(path: &Path) -> SchedulerData {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, data: &SchedulerData) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(data).map_err(std::io::Error::other)?)?;
    fs::rename(tmp, path)
}

/// The transfer a Sync/Copy/Move/Mirror task runs (`None` for Analyze).
pub fn transfer_request(task: &ScheduledTask) -> Option<TransferRequest> {
    let (mode, collision) = match task.kind {
        ScheduledTaskType::Analyze => return None,
        ScheduledTaskType::Sync => (TransferMode::Incremental, CollisionPolicy::SkipSame),
        ScheduledTaskType::Mirror => (TransferMode::Mirror, CollisionPolicy::SkipSame),
        ScheduledTaskType::Copy | ScheduledTaskType::Move => (
            if task.kind == ScheduledTaskType::Copy { TransferMode::Copy } else { TransferMode::Move },
            if task.options.incremental_only { CollisionPolicy::SkipSame } else { CollisionPolicy::OverwriteOlder },
        ),
    };
    let mut options: TransferOptions = serde_json::from_str("{}").expect("defaults");
    options.include_subfolders = task.options.include_subfolders;
    options.delete_extras = task.options.delete_at_destination;
    options.verify_after_transfer = task.options.verify_after_transfer;
    Some(TransferRequest {
        source: task.source.clone(),
        destination: task.destination.clone(),
        mode,
        collision,
        options,
        files: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sched(frequency: ScheduleFrequency, time: &str) -> Schedule {
        Schedule { frequency, time: time.into(), weekday: 0, day_of_month: 1, date: String::new() }
    }

    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, m, d, h, min, 0).earliest().unwrap()
    }

    #[test]
    fn daily_is_today_or_tomorrow() {
        let s = sched(ScheduleFrequency::Daily, "22:00");
        assert_eq!(next_run(&s, local(2026, 3, 10, 9, 0)), Some(local(2026, 3, 10, 22, 0)));
        assert_eq!(next_run(&s, local(2026, 3, 10, 22, 0)), Some(local(2026, 3, 11, 22, 0)));
    }

    #[test]
    fn weekly_finds_the_weekday() {
        // 2026-03-10 is a Tuesday.
        let mut s = sched(ScheduleFrequency::Weekly, "08:30");
        s.weekday = 0; // Monday
        assert_eq!(next_run(&s, local(2026, 3, 10, 9, 0)), Some(local(2026, 3, 16, 8, 30)));
        s.weekday = 1; // Tuesday, later today
        assert_eq!(next_run(&s, local(2026, 3, 10, 8, 0)), Some(local(2026, 3, 10, 8, 30)));
        assert_eq!(next_run(&s, local(2026, 3, 10, 9, 0)), Some(local(2026, 3, 17, 8, 30)));
    }

    #[test]
    fn monthly_clamps_to_the_last_day() {
        let mut s = sched(ScheduleFrequency::Monthly, "06:00");
        s.day_of_month = 31;
        assert_eq!(next_run(&s, local(2026, 2, 10, 0, 0)), Some(local(2026, 2, 28, 6, 0)));
        assert_eq!(next_run(&s, local(2026, 12, 31, 7, 0)), Some(local(2027, 1, 31, 6, 0)));
    }

    #[test]
    fn once_in_the_past_never_runs() {
        let mut s = sched(ScheduleFrequency::Once, "12:00");
        s.date = "2026-05-01".into();
        assert_eq!(next_run(&s, local(2026, 4, 1, 0, 0)), Some(local(2026, 5, 1, 12, 0)));
        assert_eq!(next_run(&s, local(2026, 6, 1, 0, 0)), None);
        assert_eq!(next_run(&sched(ScheduleFrequency::Daily, "25:99"), local(2026, 1, 1, 0, 0)), None);
    }

    #[test]
    fn persists_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scheduler").join("tasks.json");
        assert!(load(&path).tasks.is_empty());
        let mut data = SchedulerData::default();
        data.settings.run_missed_on_startup = false;
        save(&path, &data).unwrap();
        assert!(!load(&path).settings.run_missed_on_startup);
    }
}
