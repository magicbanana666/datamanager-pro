//! Volume list with a single-slot cache; `force_refresh` bypasses it.

use crate::models::errors::AppError;
use crate::models::storage::StorageVolume;
use crate::platform;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct Cache {
    volumes: Vec<StorageVolume>,
    fetched_at: Instant,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(10);

pub fn list_volumes(force_refresh: bool) -> Result<Vec<StorageVolume>, AppError> {
    if !force_refresh {
        if let Ok(guard) = CACHE.lock() {
            if let Some(cache) = guard.as_ref() {
                if cache.fetched_at.elapsed() < CACHE_TTL {
                    return Ok(cache.volumes.clone());
                }
            }
        }
    }

    let volumes = platform::current::list_volumes()?;

    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(Cache {
            volumes: volumes.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(volumes)
}
