export interface RuntimeAppConfig {
    API_BASE_DEFAULT?: string;
    DEFAULT_SERVER?: string;
    DEFAULT_EVENT?: string;
    DEFAULT_SAMPLE_INTERVAL_SECONDS?: string;
    DEFAULT_REQUEST_MODE?: string;
    DEFAULT_REQUEST_INTERVAL_SECONDS?: string;
    DEFAULT_AUTO_RETRY_DELAY_SECONDS?: string;
    DEFAULT_REQUEST_MINUTE_INTERVAL?: string;
    DEFAULT_REQUEST_SECOND?: string;
    DEFAULT_TIME_MINUTES?: string;
    DEFAULT_ROWS_PER_PAGE?: string;
    DEFAULT_PRIMARY_HUE?: string;
    DEFAULT_API_MODE?: string;
    DEFAULT_API_BACKEND_BASE_URL?: string;
    BACKEND_API_URL?: string;
}

declare global {
    interface Window {
        __GARUPA_RUNTIME_CONFIG__?: RuntimeAppConfig;
    }
}
