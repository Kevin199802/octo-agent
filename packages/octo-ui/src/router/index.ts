import { createRouter, createWebHashHistory } from "vue-router"
import HomeView from "@/views/HomeView.vue"

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: HomeView },
    { path: "/session/:id", component: () => import("@/views/SessionView.vue") },
    { path: "/research", component: () => import("@/views/ResearchView.vue") },
    { path: "/settings", component: () => import("@/views/SettingsView.vue") },
  ],
})

export default router
