use crate::storage;
use chrono::Datelike;

fn local_calendar_cutoffs(today: chrono::NaiveDate) -> (String, String, String) {
    let day_start = today
        .and_hms_opt(0, 0, 0)
        .expect("midnight is always a valid local naive time");
    let week_start =
        day_start - chrono::Duration::days(today.weekday().num_days_from_monday().into());
    let month_start = chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .expect("the first day of a valid month is always valid");

    (
        day_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
        week_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
        month_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
    )
}

#[tauri::command]
pub async fn get_history(
    state: tauri::State<'_, storage::HistoryStore>,
    limit: u32,
    offset: u32,
) -> Result<Vec<storage::HistoryEntry>, String> {
    state.list(limit, offset).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_history_count(
    state: tauri::State<'_, storage::HistoryStore>,
) -> Result<u64, String> {
    state.count().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_history(state: tauri::State<'_, storage::HistoryStore>) -> Result<(), String> {
    state.clear().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_transcription_time_stats(
    state: tauri::State<'_, storage::HistoryStore>,
) -> Result<storage::TranscriptionTimeStats, String> {
    let (day_start, week_start, month_start) =
        local_calendar_cutoffs(chrono::Local::now().date_naive());

    state
        .transcription_time_stats(&day_start, &week_start, &month_start)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_local_activity_metrics(
    state: tauri::State<'_, storage::HistoryStore>,
) -> Result<storage::LocalActivityMetricsSummary, String> {
    let now = chrono::Local::now();
    let (day_start, week_start, month_start) = local_calendar_cutoffs(now.date_naive());
    let now = now.format("%Y-%m-%dT%H:%M:%S").to_string();

    state
        .local_activity_metrics(&day_start, &week_start, &month_start, &now)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_calendar_cutoffs_use_monday_and_first_of_month() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 12).unwrap();

        assert_eq!(
            local_calendar_cutoffs(today),
            (
                "2026-08-12T00:00:00".to_string(),
                "2026-08-10T00:00:00".to_string(),
                "2026-08-01T00:00:00".to_string(),
            )
        );
    }
}
