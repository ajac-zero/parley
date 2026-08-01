import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];

const STORAGE_KEY = "parley-locale";

const translations = {
  en: {
    language: "Language",
    english: "English",
    spanish: "Spanish",
    newChat: "New chat",
    agents: "Agents",
    chats: "Chats",
    searchChats: "Search chats",
    noChatsYet: "No chats yet.",
    noChatsMatch: "No chats match your search.",
    today: "Today",
    yesterday: "Yesterday",
    previous7Days: "Previous 7 days",
    previous30Days: "Previous 30 days",
    older: "Older",
    settings: "Settings",
    admin: "Admin",
    signOut: "Sign out",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    welcomeBack: "Welcome back",
    signInToContinue: "Sign in to continue to {appName}",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in...",
    noAccount: "No account yet?",
    createOne: "Create one",
    createAccount: "Create your account",
    getStarted: "Get started with {appName}",
    name: "Name",
    atLeast8Characters: "At least 8 characters",
    creatingAccount: "Creating account...",
    alreadyHaveAccount: "Already have an account?",
    registrationDisabled: "Registration is disabled on this deployment.",
    askAdministrator: "Ask an administrator for an account, then sign in.",
    chooseAgent: "Choose an agent",
    noAgentsAvailable: "No agents available yet.",
    addAgent: "Add an agent",
    shared: "shared",
    disabled: "disabled",
    messageYourAgent: "Message your agent...",
    addAgentToChat: "Add an agent to start chatting",
    agentUnavailable: "Agent unavailable",
    agentsCanMakeMistakes:
      "Agents can make mistakes. Verify important information.",
    uploadFailed: "Upload failed.",
    filesMustBeUnder: "Files must be under {size} MB.",
    removeFile: "Remove {filename}",
    uploadFiles: "Upload files",
    moreActions: "More actions",
    addPhotosOrFiles: "Add photos or files",
    sendMessage: "Send message",
    stopGenerating: "Stop generating",
    copyMessage: "Copy message",
    editMessage: "Edit message",
    copyResponse: "Copy response",
    regenerateResponse: "Regenerate response",
    cancel: "Cancel",
    send: "Send",
    thinking: "Thinking...",
    thoughtProcess: "Thought process",
    generationStopped: "Generation stopped.",
    retry: "Retry",
    dismiss: "Dismiss",
    greetingMorning: "Good morning{suffix}",
    greetingAfternoon: "Good afternoon{suffix}",
    greetingEvening: "Good evening{suffix}",
    greetingNight: "Hello{suffix} 🌙",
  },
  es: {
    language: "Idioma",
    english: "Inglés",
    spanish: "Español",
    newChat: "Nuevo chat",
    agents: "Agentes",
    chats: "Chats",
    searchChats: "Buscar chats",
    noChatsYet: "Aún no hay chats.",
    noChatsMatch: "Ningún chat coincide con la búsqueda.",
    today: "Hoy",
    yesterday: "Ayer",
    previous7Days: "Últimos 7 días",
    previous30Days: "Últimos 30 días",
    older: "Anteriores",
    settings: "Configuración",
    admin: "Administración",
    signOut: "Cerrar sesión",
    theme: "Tema",
    light: "Claro",
    dark: "Oscuro",
    system: "Sistema",
    welcomeBack: "Te damos la bienvenida",
    signInToContinue: "Inicia sesión para continuar en {appName}",
    email: "Correo electrónico",
    password: "Contraseña",
    signIn: "Iniciar sesión",
    signingIn: "Iniciando sesión...",
    noAccount: "¿No tienes una cuenta?",
    createOne: "Crea una",
    createAccount: "Crea tu cuenta",
    getStarted: "Comienza a usar {appName}",
    name: "Nombre",
    atLeast8Characters: "Al menos 8 caracteres",
    creatingAccount: "Creando cuenta...",
    alreadyHaveAccount: "¿Ya tienes una cuenta?",
    registrationDisabled: "El registro está desactivado en esta instalación.",
    askAdministrator:
      "Pide una cuenta al administrador y, después, inicia sesión.",
    chooseAgent: "Elige un agente",
    noAgentsAvailable: "Aún no hay agentes disponibles.",
    addAgent: "Añadir un agente",
    shared: "compartido",
    disabled: "desactivado",
    messageYourAgent: "Envía un mensaje a tu agente...",
    addAgentToChat: "Añade un agente para empezar a chatear",
    agentUnavailable: "Agente no disponible",
    agentsCanMakeMistakes:
      "Los agentes pueden cometer errores. Verifica la información importante.",
    uploadFailed: "Error al subir el archivo.",
    filesMustBeUnder: "Los archivos deben pesar menos de {size} MB.",
    removeFile: "Eliminar {filename}",
    uploadFiles: "Subir archivos",
    moreActions: "Más acciones",
    addPhotosOrFiles: "Añadir fotos o archivos",
    sendMessage: "Enviar mensaje",
    stopGenerating: "Detener generación",
    copyMessage: "Copiar mensaje",
    editMessage: "Editar mensaje",
    copyResponse: "Copiar respuesta",
    regenerateResponse: "Regenerar respuesta",
    cancel: "Cancelar",
    send: "Enviar",
    thinking: "Pensando...",
    thoughtProcess: "Proceso de razonamiento",
    generationStopped: "Se detuvo la generación.",
    retry: "Reintentar",
    dismiss: "Descartar",
    greetingMorning: "Buenos días{suffix}",
    greetingAfternoon: "Buenas tardes{suffix}",
    greetingEvening: "Buenas noches{suffix}",
    greetingNight: "Hola{suffix} 🌙",
  },
} as const;

type TranslationKey = keyof (typeof translations)["en"];
type Variables = Record<string, string | number>;

function supportedLocale(value: string | null | undefined): Locale | null {
  const language = value?.toLowerCase().split("-")[0];
  return locales.find((locale) => locale === language) ?? null;
}

function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return (
    supportedLocale(window.localStorage.getItem(STORAGE_KEY)) ??
    supportedLocale(window.navigator.language) ??
    "en"
  );
}

function interpolate(message: string, values?: Variables): string {
  return message.replace(/\{(\w+)\}/g, (_, name: string) =>
    values?.[name] === undefined ? `{${name}}` : String(values[name]),
  );
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Variables) => string;
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const defaultI18n: I18nContextValue = {
  locale: "en",
  setLocale: () => {},
  t: (key, values) => interpolate(translations.en[key], values),
  formatDate: (date, options) =>
    new Intl.DateTimeFormat("en", options).format(date),
  formatNumber: (number, options) =>
    new Intl.NumberFormat("en", options).format(number),
};

const I18nContext = createContext<I18nContextValue>(defaultI18n);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
  };

  const value: I18nContextValue = {
    locale,
    setLocale,
    t: (key, values) => interpolate(translations[locale][key], values),
    formatDate: (date, options) =>
      new Intl.DateTimeFormat(locale, options).format(date),
    formatNumber: (number, options) =>
      new Intl.NumberFormat(locale, options).format(number),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={className}>
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="h-8 rounded-md border bg-transparent px-2 text-sm"
      >
        <option value="en">{t("english")}</option>
        <option value="es">{t("spanish")}</option>
      </select>
    </label>
  );
}
