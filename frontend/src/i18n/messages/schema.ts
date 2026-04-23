export interface I18nMessages {
    menu: {
        home: string;
        settings: string;
        about: string;
        launcher: string;
        collapse: string;
        expand: string;
    };
    topbar: {
        title: string;
        status: string;
        lastUpdate: string;
        notSynced: string;
        refresh: string;
        pauseAuto: string;
        resumeAuto: string;
    };
    status: {
        fetching: string;
        error: string;
        online: string;
    };
    filters: {
        server: string;
        event: string;
        eventId: string;
        interval: string;
        timeWindow: string;
        eventLoading: string;
        eventEmpty: string;
        applyEvent: string;
        advancedInSettings: string;
    };
    table: {
        title: string;
        empty: string;
        time: string;
        headerUid: string;
        headerName: string;
        headerScore: string;
        totalScore: string;
        tooltipPlayerName: string;
        tooltipTotalScore: string;
        paginationSummary: string;
        paginationPage: string;
        paginationFirst: string;
        paginationPrevious: string;
        paginationNext: string;
        paginationLast: string;
    };
    home: {
        manualRefresh: string;
        eventTitle: string;
        eventType: string;
        eventStart: string;
        eventEnd: string;
        eventLoading: string;
        eventEmpty: string;
        eventUnknown: string;
        footerThanks: string;
        footerDataProvided: string;
        footerGitHub: string;
        eventTypes: {
            liveTry: string;
            challenge: string;
            missionLive: string;
            versus: string;
            medley: string;
            festival: string;
        };
    };
    settings: {
        title: string;
        queryTitle: string;
        tableTitle: string;
        rowsPerPage: string;
        hue: string;
        apiTitle: string;
        apiMode: string;
        apiModeFrontend: string;
        apiModeBackend: string;
        apiFrontendDescription: string;
        apiBackendBaseUrl: string;
        apiBackendPlaceholder: string;
        apiBackendHint: string;
        apiBackendRequired: string;
        apiCorsHint: string;
        requestTitle: string;
        sampleInterval: string;
        requestMode: string;
        requestModeFixedInterval: string;
        requestModeFixedMinute: string;
        requestModeSmartRefresh: string;
        requestModeSmartRefreshHint: string;
        requestIntervalSeconds: string;
        requestMinuteInterval: string;
        requestSecond: string;
        requestAutoRetryDelaySeconds: string;
        save: string;
    };
    about: {
        title: string;
        desc: string;
        source: string;
    };
    error: {
        requestFailed: string;
        unknown: string;
    };
}
