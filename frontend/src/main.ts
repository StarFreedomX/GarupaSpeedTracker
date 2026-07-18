import { createApp } from "vue";
import App from "@/App.vue";
import "./style/main.css";
import { useI18n } from "@/i18n";
import router from "./router";

const { locale } = useI18n();
document.documentElement.lang = locale.value;

const app = createApp(App);
app.use(router);
app.mount("#app");
