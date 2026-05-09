export interface I18nMessages {
    menu: {
        home: string;
        auto: string;
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
        headerPoint: string;
        totalPoint: string;
        tooltipPlayerName: string;
        tooltipTotalPoint: string;
        paginationSummary: string;
        paginationPage: string;
        paginationFirst: string;
        paginationPrevious: string;
        paginationNext: string;
        paginationLast: string;
    };
    eventType: {
        mission: string;
        try: string;
        versus: string;
        challenge: string;
        "5v5": string;
        medley1: string;
    };
    common: {
        calculate: string;
        calculating: string;
        resetAll: string;
        resetDefault: string;
        loading: string;
        unitSecond: string;
    };
    // 在 I18nMessages 中添加或确认以下内容
    bonus: {
        title: string;
        targetPt: string;
        targetPtPlaceholder: string;
        supportPower: string;
        tableBonus: string;
        tableScoreRange: string;
        noResult: string;
        inputPrompt: string;
        theoryTitle: string;
        theoryDesc: string;
        usageTitle: string;
        usageDesc: string;
    };
    auto: {
        server: {
            jp: string;
            cn: string;
            others: string;
        };
        config: {
            eventParams: string;
            eventType: string;
            totalPower: string;
            supportPower: string;
            eventBonus: string;
            autoRate: string;
            rateLabel: string;
            ratePlaceholder: string;
            skillConfig: string;
            filterFixedPt: string;
            skillOrderHint: string;
            skillRateLabel: string;
            skillCenterHint: string;
            skillNote: string;
        };
        table: {
            songId: string;
            songName: string;
            difficulty: string;
            minScore: string;
            maxScore: string;
            minPt: string;
            maxPt: string;
            emptyFiltered: string;
            emptyPrompt: string;
        };
        error: {
            loadMetadata: string;
            metadataNotReady: string;
            loadSongList: string;
            calcFailed: string;
        };
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
