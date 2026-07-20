use crate::storage;
use chrono::Datelike;

#[tauri::command]
pub async fn get_history(
    state: tauri::State<'_, storage::HistoryStore>,
    limit: u32,
    offset: u32,
) -> Result<Vec<storage::HistoryEntry>, String> {
    state.list(limit, offset).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_history(state: tauri::State<'_, storage::HistoryStore>) -> Result<(), String> {
    state.clear().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_transcription_time_stats(
    state: tauri::State<'_, storage::HistoryStore>,
) -> Result<storage::TranscriptionTimeStats, String> {
    let today = chrono::Local::now().date_naive();
    let day_start = today
        .and_hms_opt(0, 0, 0)
        .expect("midnight is always a valid local naive time");
    let week_start =
        day_start - chrono::Duration::days(today.weekday().num_days_from_monday().into());
    let month_start = chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .expect("the first day of a valid month is always valid");

    state
        .transcription_time_stats(
            &day_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
            &week_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
            &month_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
        )
        .await
        .map_err(|error| error.to_string())
}
