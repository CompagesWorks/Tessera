use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::bridge::{get, run, to_js};
use crate::error::Result;

pub async fn get_state<T: DeserializeOwned>() -> Result<T> {
    get(&["widget", "getState"], &[]).await
}

pub async fn set_state<T: Serialize>(state: &T) -> Result<()> {
    run(&["widget", "setState"], &[to_js(state)?]).await
}
