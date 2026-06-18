export interface I18nMessages {
    menu: {
        home: string;
        auto: string;
        bonus: string;
        interactive: string;
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
            totalPowerNote: string;
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
            progressiveToggle: string;
            progressiveStepRate: string;
            progressiveMaxCap: string;
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
        calculatorTitle: string;
        minRecPower: string;
        maxRecPower: string;
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
    interactive: {
        title: string;
        step: string;
        step1: { title: string };
        step2: { title: string };
        step3: {
            title: string;
            targetPt: string;
            placeholder: string;
        };
        step4: {
            title: string;
            computing: string;
            solution: string;
            playsCount: string;
            flameCount: string;
            ptRange: string;
            recommendSongs: string;
            songColName: string;
            songColDifficulty: string;
            songColPtRange: string;
            noSolution: string;
            maxAchievable: string;
            adjustBonus: string;
            adjustBonusHint: string;
            bonusTableBonus: string;
            bonusTableScore: string;
            bonusTablePower: string;
            basePT: string;
            totalPT: string;
            songsAvailable: string;
            scoreRange: string;
            mainPlan: string;
            altPlan: string;
            noSongsForStep: string;
            adjustConfigHint: string;
            recommendPT: string;
            windowPreview: string;
            segmentLen: string;
            playsLabel: string;
        };
        filter: {
            title: string;
            allowFull: string;
            bandFilter: string;
            bandModeContains: string;
            bandModeAll: string;
            boostString: string;
            boostPlaceholder: string;
            reset: string;
        };
        status: {
            noFixedSongs: string;
            noFixedSongsHint: string;
            targetTooLow: string;
            targetTooLowHint: string;
        };
        btn: {
            prev: string;
            next: string;
            analyze: string;
            recalc: string;
        };
        error: {
            invalidPt: string;
            noMetadata: string;
        };
    };
    playerDeck: {
        title: string;
        server: string;
        event: string;
        playerId: string;
        fetch: string;
        success: string;
        warnPowerNotPublic: string;
        warnMissionSupport: string;
        warnMedleyCheck: string;
        error: string;
    };
    error: {
        requestFailed: string;
        unknown: string;
    };
}
