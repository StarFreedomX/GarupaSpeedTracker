/**
 * 输入框过滤工具。
 *
 * 用法：在 <input> 上添加：
 *   @input="sanitizeIntInput"     — 过滤粘贴 / 剪贴板
 *   @blur="..."                   — 解析并提交
 * 配合 type="text" + inputmode="numeric|decimal"。
 */

// ── input 过滤（处理粘贴 / 剪贴板等绕过 keydown 的输入）──

/** 整数：去掉所有非数字字符。IME 组合中跳过。 */
export function sanitizeIntInput(e: InputEvent) {
    if (e.isComposing) return;
    const input = e.target as HTMLInputElement;
    const filtered = input.value.replace(/\D/g, "");
    if (filtered !== input.value) {
        input.value = filtered;
    }
}

/** 小数：去掉非数字非小数点字符，只保留第一个小数点。IME 组合中跳过。 */
export function sanitizeDecimalInput(e: InputEvent) {
    if (e.isComposing) return;
    const input = e.target as HTMLInputElement;
    const filtered = input.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    if (filtered !== input.value) {
        input.value = filtered;
    }
}
