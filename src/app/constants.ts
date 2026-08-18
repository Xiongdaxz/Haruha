import {
  Cog,
  FolderOpen,
  Globe2,
  Info,
  Leaf,
  Monitor,
  Moon,
  Palette,
  Sun,
  Sunset,
  Waypoints,
} from "lucide-react";
import packageMetadata from "../../package.json";
import type { QuickSite, QuickSiteCategory } from "../lib/types";
import type { NavKey, ResizableNavKey, SettingsKey, ThemePreference } from "./types";

export const APP_NAME = "Haruha";
export const APP_VERSION = packageMetadata.version;
export const OPEN_SOURCE_REPOSITORY_URL = "https://github.com/Xiongdaxz/Haruha";
export const SPLIT_HANDLE_WIDTH = 16;
export const SPLIT_LIMITS: Record<ResizableNavKey, { minLeft: number; minRight: number }> = {
  config: { minLeft: 320, minRight: 470 },
  pac: { minLeft: 300, minRight: 470 },
};
export const SPLIT_STORAGE_KEYS: Record<ResizableNavKey, string> = {
  config: "haruha.split.config.leftWidth",
  pac: "haruha.split.pac.leftWidth",
};
export const THEME_STORAGE_KEY = "haruha.appearance.theme";
export const THEME_PREFERENCE_CHANGED_EVENT = "theme-preference-changed";
export const DEFAULT_PAC_URL = "http://127.0.0.1:18765/proxy.pac";
export const SPEED_TEST_STORAGE_KEY = "haruha.speedTest.config";
export const SPEED_TEST_HISTORY_STORAGE_KEY = "haruha.speedTest.history";
export const UPDATE_AUTO_CHECK_STORAGE_KEY = "haruha.update.autoCheck";
export const UPDATE_LAST_CHECK_STORAGE_KEY = "haruha.update.lastCheckAt";
export const UPDATE_NOTIFIED_VERSION_STORAGE_KEY = "haruha.update.notifiedVersion";
export const UPDATE_PENDING_VERSION_STORAGE_KEY = "haruha.update.pendingVersion";
export const ProxyIcon = Waypoints;
export const PacIcon = Globe2;

export const navItems = [
  { key: "overview", label: "总览", icon: Leaf },
  { key: "config", label: "手动代理", icon: ProxyIcon },
  { key: "pac", label: "PAC自动", icon: PacIcon },
  { key: "settings", label: "设置", icon: Cog },
] satisfies Array<{ key: NavKey; label: string; icon: typeof Leaf }>;

export const settingsItems = [
  { key: "appearance", label: "外观", description: "主题与预览", icon: Palette },
  { key: "unified-lists", label: "代理名单", description: "统一直连/代理名单", icon: ProxyIcon },
  { key: "config-directory", label: "配置目录", description: "查看配置、日志与缓存", icon: FolderOpen },
  { key: "about", label: "关于", description: "版本、更新与开源信息", icon: Info },
] satisfies Array<{ key: SettingsKey; label: string; description: string; icon: typeof Leaf }>;

export const themeOptions = [
  {
    key: "system",
    label: "跟随系统",
    description: "自动切换浅色/深色",
    icon: Monitor,
    preview: {
      accent: "#596579",
      side: "#e9edf3",
      surface: "#fbfcfe",
      support: "#9aa6b7",
      tint: "#eef2f7",
    },
  },
  {
    key: "light",
    label: "日暮",
    description: "浅色模式",
    icon: Sun,
    preview: {
      accent: "#2563eb",
      side: "#eaf1ff",
      surface: "#ffffff",
      support: "#14a38b",
      tint: "#f6f9ff",
    },
  },
  {
    key: "dark",
    label: "星辰",
    description: "深色模式",
    icon: Moon,
    preview: {
      accent: "#78a6ff",
      side: "#182334",
      surface: "#111923",
      support: "#91a3cb",
      tint: "#0c121a",
    },
  },
  {
    key: "haruha",
    label: "春羽",
    description: "柔和绿调",
    icon: Leaf,
    preview: {
      accent: "#13a66f",
      side: "#e7f6ec",
      surface: "#fbfefb",
      support: "#7fb069",
      tint: "#f3faf5",
    },
  },
  {
    key: "sunset",
    label: "暮光",
    description: "暖调纸感",
    icon: Sunset,
    preview: {
      accent: "#c95f35",
      side: "#f6e5d7",
      surface: "#fff9f1",
      support: "#8f6f45",
      tint: "#fdf0e5",
    },
  },
] satisfies Array<{
  key: ThemePreference;
  label: string;
  description: string;
  icon: typeof Leaf;
  preview: {
    accent: string;
    side: string;
    surface: string;
    support: string;
    tint: string;
  };
}>;

export const quickSiteCategories = [
  { key: "ai", label: "AI" },
  { key: "social", label: "社交" },
  { key: "dev", label: "开发" },
  { key: "tools", label: "工具" },
  { key: "media", label: "媒体" },
] satisfies Array<{ key: QuickSiteCategory; label: string }>;

export const quickSites: QuickSite[] = [
  quickSite("chatgpt", "ChatGPT", "https://chatgpt.com/", "chatgpt.com", "ai"),
  quickSite("claude", "Claude", "https://claude.ai/", "claude.ai", "ai"),
  quickSite("manus", "Manus", "https://manus.im/", "manus.im", "ai"),
  quickSite("gemini", "Gemini", "https://gemini.google.com/", "gemini.google.com", "ai"),
  quickSite("perplexity", "Perplexity", "https://www.perplexity.ai/", "perplexity.ai", "ai"),
  quickSite("grok", "Grok", "https://grok.com/", "grok.com", "ai"),
  quickSite("copilot", "Copilot", "https://copilot.microsoft.com/", "copilot.microsoft.com", "ai"),
  quickSite("deepseek", "DeepSeek", "https://chat.deepseek.com/", "deepseek.com", "ai"),
  quickSite("meta-ai", "Meta AI", "https://www.meta.ai/", "meta.ai", "ai"),
  quickSite("huggingface", "Hugging Face", "https://huggingface.co/", "huggingface.co", "ai"),
  quickSite("doubao", "豆包", "https://www.doubao.com/", "doubao.com", "ai"),
  quickSite("google-ai-studio", "Google AI Studio", "https://aistudio.google.com/", "aistudio.google.com", "ai"),
  quickSite("notebooklm", "NotebookLM", "https://notebooklm.google.com/", "notebooklm.google.com", "ai"),
  quickSite("midjourney", "Midjourney", "https://www.midjourney.com/", "midjourney.com", "ai"),
  quickSite("kimi", "Kimi", "https://www.kimi.com/", "kimi.com", "ai"),
  quickSite("qwen", "千问", "https://www.qianwen.com/", "qianwen.com", "ai"),
  quickSite("chatglm", "智谱清言", "https://chatglm.cn/", "chatglm.cn", "ai"),
  quickSite("x", "X", "https://x.com/", "x.com", "social"),
  quickSite("instagram", "Instagram", "https://www.instagram.com/", "instagram.com", "social"),
  quickSite("youtube", "YouTube", "https://www.youtube.com/", "youtube.com", "social"),
  quickSite("tiktok", "TikTok", "https://www.tiktok.com/", "tiktok.com", "social"),
  quickSite("reddit", "Reddit", "https://www.reddit.com/", "reddit.com", "social"),
  quickSite("linux-do", "LINUX DO", "https://linux.do/", "linux.do", "social"),
  quickSite("discord", "Discord", "https://discord.com/", "discord.com", "social"),
  quickSite("telegram", "Telegram", "https://web.telegram.org/", "telegram.org", "social"),
  quickSite("facebook", "Facebook", "https://www.facebook.com/", "facebook.com", "social"),
  quickSite("whatsapp", "WhatsApp", "https://web.whatsapp.com/", "whatsapp.com", "social"),
  quickSite("twitch", "Twitch", "https://www.twitch.tv/", "twitch.tv", "social"),
  quickSite("pinterest", "Pinterest", "https://www.pinterest.com/", "pinterest.com", "social"),
  quickSite("linkedin", "LinkedIn", "https://www.linkedin.com/", "linkedin.com", "social"),
  quickSite("threads", "Threads", "https://www.threads.net/", "threads.net", "social"),
  quickSite("bluesky", "Bluesky", "https://bsky.app/", "bsky.app", "social"),
  quickSite("snapchat", "Snapchat", "https://www.snapchat.com/", "snapchat.com", "social"),
  quickSite("quora", "Quora", "https://www.quora.com/", "quora.com", "social"),
  quickSite("tumblr", "Tumblr", "https://www.tumblr.com/", "tumblr.com", "social"),
  quickSite("line", "LINE", "https://line.me/", "line.me", "social"),
  quickSite("bocha-search-api", "博查搜索 API", "https://open.bochaai.com/", "open.bochaai.com", "dev"),
  quickSite("brave-search-api", "Brave Search API", "https://brave.com/search/api/", "brave.com", "dev"),
  quickSite("github", "GitHub", "https://github.com/", "github.com", "dev"),
  quickSite("stackoverflow", "Stack Overflow", "https://stackoverflow.com/", "stackoverflow.com", "dev"),
  quickSite("gitlab", "GitLab", "https://gitlab.com/", "gitlab.com", "dev"),
  quickSite("docker", "Docker Hub", "https://hub.docker.com/", "docker.com", "dev"),
  quickSite("npm", "npm", "https://www.npmjs.com/", "npmjs.com", "dev"),
  quickSite("mdn", "MDN", "https://developer.mozilla.org/", "developer.mozilla.org", "dev"),
  quickSite("vercel", "Vercel", "https://vercel.com/", "vercel.com", "dev"),
  quickSite("cloudflare", "Cloudflare", "https://dash.cloudflare.com/", "cloudflare.com", "dev"),
  quickSite("aws", "AWS", "https://aws.amazon.com/", "aws.amazon.com", "dev"),
  quickSite("bitbucket", "Bitbucket", "https://bitbucket.org/", "bitbucket.org", "dev"),
  quickSite("replit", "Replit", "https://replit.com/", "replit.com", "dev"),
  quickSite("pypi", "PyPI", "https://pypi.org/", "pypi.org", "dev"),
  quickSite("codepen", "CodePen", "https://codepen.io/", "codepen.io", "dev"),
  quickSite("leetcode", "LeetCode", "https://leetcode.com/", "leetcode.com", "dev"),
  quickSite("google", "Google", "https://www.google.com/", "google.com", "tools"),
  quickSite("bing", "Bing", "https://www.bing.com/", "bing.com", "tools"),
  quickSite("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/", "duckduckgo.com", "tools"),
  quickSite("gmail", "Gmail", "https://mail.google.com/", "gmail.com", "tools"),
  quickSite("outlook", "Outlook", "https://outlook.live.com/", "live.com", "tools"),
  quickSite("maps", "Google Maps", "https://maps.google.com/", "maps.google.com", "tools"),
  quickSite("drive", "Google Drive", "https://drive.google.com/", "drive.google.com", "tools"),
  quickSite("notion", "Notion", "https://www.notion.so/", "notion.so", "tools"),
  quickSite("canva", "Canva", "https://www.canva.com/", "canva.com", "tools"),
  quickSite("figma", "Figma", "https://www.figma.com/", "figma.com", "tools"),
  quickSite("dropbox", "Dropbox", "https://www.dropbox.com/", "dropbox.com", "tools"),
  quickSite("weather", "Weather", "https://weather.com/", "weather.com", "tools"),
  quickSite("google-translate", "Google Translate", "https://translate.google.com/", "translate.google.com", "tools"),
  quickSite("onedrive", "OneDrive", "https://onedrive.live.com/", "onedrive.live.com", "tools"),
  quickSite("microsoft-365", "Microsoft 365", "https://www.microsoft365.com/", "microsoft365.com", "tools"),
  quickSite("zoom", "Zoom", "https://zoom.us/", "zoom.us", "tools"),
  quickSite("speedtest", "Speedtest", "https://www.speedtest.net/", "speedtest.net", "tools"),
  quickSite("wikipedia", "Wikipedia", "https://www.wikipedia.org/", "wikipedia.org", "media"),
  quickSite("youtube-music", "YouTube Music", "https://music.youtube.com/", "music.youtube.com", "media"),
  quickSite("netflix", "Netflix", "https://www.netflix.com/", "netflix.com", "media"),
  quickSite("spotify", "Spotify", "https://open.spotify.com/", "spotify.com", "media"),
  quickSite("amazon", "Amazon", "https://www.amazon.com/", "amazon.com", "media"),
  quickSite("prime-video", "Prime Video", "https://www.primevideo.com/", "primevideo.com", "media"),
  quickSite("disney", "Disney+", "https://www.disneyplus.com/", "disneyplus.com", "media"),
  quickSite("vimeo", "Vimeo", "https://vimeo.com/", "vimeo.com", "media"),
  quickSite("nytimes", "NYTimes", "https://www.nytimes.com/", "nytimes.com", "media"),
  quickSite("bbc", "BBC", "https://www.bbc.com/", "bbc.com", "media"),
  quickSite("medium", "Medium", "https://medium.com/", "medium.com", "media"),
  quickSite("yahoo", "Yahoo", "https://www.yahoo.com/", "yahoo.com", "media"),
  quickSite("fandom", "Fandom", "https://www.fandom.com/", "fandom.com", "media"),
  quickSite("imdb", "IMDb", "https://www.imdb.com/", "imdb.com", "media"),
  quickSite("reuters", "Reuters", "https://www.reuters.com/", "reuters.com", "media"),
  quickSite("soundcloud", "SoundCloud", "https://soundcloud.com/", "soundcloud.com", "media"),
  quickSite("apple-music", "Apple Music", "https://music.apple.com/", "music.apple.com", "media"),
  quickSite("crunchyroll", "Crunchyroll", "https://www.crunchyroll.com/", "crunchyroll.com", "media"),
];

function quickSite(
  id: string,
  name: string,
  url: string,
  domain: string,
  category: QuickSiteCategory,
): QuickSite {
  return {
    id,
    name,
    url,
    domain,
    category,
    faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  };
}
