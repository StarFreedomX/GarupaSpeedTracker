import type * as Koa from "koa";
import type { ValidationRules } from "parameter";

// 1. 扩展 Koa 内部的类型
declare module "koa" {
    interface Context {
        verifyParams(rules: ValidationRules, params?: Record<string, unknown>): void;
    }
}

// 2. 定义库本身的导出
declare module "koa-parameter" {
    function parameter(app: Koa): void;
    export = parameter;
}
