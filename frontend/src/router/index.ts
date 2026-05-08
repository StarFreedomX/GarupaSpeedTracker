import { createRouter, createWebHistory } from "vue-router";
import AboutView from "@/views/AboutView.vue";
import AutoView from "@/views/AutoView.vue";
import HomeView from "@/views/HomeView.vue";
import SettingsView from "@/views/SettingsView.vue";

const routes = [
    { path: "/", redirect: "/auto" }, // 设置默认跳转到 auto
    { path: "/home", name: "home", component: HomeView },
    { path: "/auto", name: "auto", component: AutoView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/about", name: "about", component: AboutView },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

export default router;
