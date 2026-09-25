// BLE 适配器入口：按平台条件编译选择实现（接口完全一致）
// #ifdef H5
export { PianoBLE } from "./ble-h5.js";
// #endif
// #ifndef H5
export { PianoBLE } from "./ble-mp.js";
// #endif
