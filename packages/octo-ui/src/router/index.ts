import { createRouter, createWebHashHistory } from "vue-router"
import ChatView from "@/views/ChatView.vue"

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: ChatView },
    { path: "/session/:id", component: ChatView },
    { path: "/settings", component: () => import("@/views/SettingsView.vue") },
  ],
})

export default router
