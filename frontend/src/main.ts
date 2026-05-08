import { createApp } from "vue";
import App from "@/App.vue";
import "./style/main.css";
import router from "./router";

document.documentElement.lang = "zh-CN";

const app = createApp(App);
app.use(router);
app.mount("#app");
