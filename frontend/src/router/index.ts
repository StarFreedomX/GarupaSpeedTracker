import { createRouter, createWebHashHistory } from "vue-router";

// 统一使用动态导入 (Route-level code-splitting)
const routes = [
    { path: "/", redirect: "/auto" },
    {
        path: "/home",
        name: "home",
        component: () => import("@/views/HomeView.vue"),
    },
    {
        path: "/auto",
        name: "auto",
        component: () => import("@/views/AutoView.vue"),
    },
    {
        path: "/bonus",
        name: "bonus",
        component: () => import("@/views/BonusView.vue"),
    },
    {
        path: "/settings",
        name: "settings",
        component: () => import("@/views/SettingsView.vue"),
    },
    {
        path: "/about",
        name: "about",
        component: () => import("@/views/AboutView.vue"),
    },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

export default router;
