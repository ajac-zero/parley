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
    appearance: "Appearance",
    behavior: "Behavior",
    profile: "Profile",
    currentPassword: "Current password",
    newPassword: "New password",
    save: "Save",
    changing: "Changing...",
    changePassword: "Change password",
    showReasoning: "Show reasoning",
    reasoningDescription:
      "Keep an agent's thinking expanded by default. Off keeps it collapsed until you click to expand it.",
    nameUpdated: "Name updated.",
    passwordChanged: "Password changed.",
    couldNotUpdateName: "Could not update your name.",
    couldNotChangePassword: "Could not change your password.",
    agentsDescription:
      "Connect endpoints that speak the Open Responses protocol and chat with them.",
    noAgentsYet: "No agents yet",
    addFirstAgent: "Add your first Open Responses endpoint to start chatting.",
    chatWith: "Chat with {name}",
    edit: "Edit {name}",
    delete: "Delete {name}",
    agentDeleted: "Agent deleted.",
    deleteAgentConfirmation:
      'Delete "{name}"? Conversations with it are kept but can no longer continue.',
    editAgent: "Edit agent",
    importAgentCard: "Import from agent card",
    import: "Import",
    fetching: "Fetching...",
    agentCardHelp:
      "Fetches /.well-known/agent-card.json (A2A agent card) and prefills the form, including the Open Responses URL.",
    agentCardImported: "Agent card imported. Review the fields below and save.",
    agentCardMissingInterface:
      "Card imported, but it doesn't declare an Open Responses interface. Enter the base URL manually.",
    description: "Description",
    avatar: "Avatar",
    baseUrl: "Base URL",
    apiKey: "API key",
    model: "Model",
    instructions: "Instructions",
    conversationState: "Conversation state",
    fileDelivery: "File delivery",
    imageInput: "Image input",
    fileInput: "File input",
    enabled: "Enabled",
    sharedWithEveryone: "Shared with everyone",
    saveChanges: "Save changes",
    saving: "Saving...",
    syncing: "Syncing...",
    resync: "Re-sync",
    agentUpdated: "Agent updated.",
    agentCreated: "Agent created.",
    extraParametersMustBeJson: "Extra parameters must be a JSON object.",
    optionalBearerToken: "Optional bearer token",
    optional: "optional",
    replayTranscript: "Replay transcript (stateless)",
    agentStoresState: "previous_response_id (agent stores state)",
    capabilityUrlDelivery: "Capability URL (agent fetches from Parley)",
    inlineFileDelivery: "Inline base64 (agent cannot reach Parley)",
    personalAgentsDisabled: "Personal agents are disabled on this deployment.",
    conversationNotFound: "This conversation doesn't exist.",
    startNewChat: "Start a new chat",
    navigation: "Navigation",
    openSidebar: "Open sidebar",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    saveName: "Save name",
    cancelRename: "Cancel rename",
    chatOptions: "Chat options",
    close: "Close",
    pinned: "Pinned",
    unpin: "Unpin",
    pinToCanvas: "Pin to canvas",
    unpinToShowInline: "Unpin to show inline",
    pinnedToCanvas: "Pinned to canvas",
    filter: "Filter...",
    adminDescription: "Manage this deployment: branding, access, and members.",
    brandingAccess: "Branding & access",
    catalogs: "Catalogs",
    members: "Members",
    installedCatalogPlugins: "Installed catalog plugins",
    catalogPluginsDescription:
      "These trusted renderers are installed in this Parley build. Disabling one falls back to the tool's text response instead of rendering its UI.",
    builtIn: "Built in",
    catalogId: "Catalog ID",
    enable: "Enable {name}",
    disable: "Disable {name}",
    saveCatalogs: "Save catalogs",
    catalogSettingsSaved: "Catalog settings saved.",
    openCatalogId: "Open catalog ID",
    copyCatalogId: "Copy catalog ID",
    catalogIdCopied: "Catalog ID copied",
    branding: "Branding",
    appName: "App name",
    tagline: "Tagline",
    logoUrl: "Logo URL",
    composerDisclaimer: "Composer disclaimer",
    themeCss: "Theme CSS",
    access: "Access",
    openRegistration: "Open registration",
    openRegistrationDescription:
      "Allow anyone to create an account on this deployment.",
    personalAgents: "Personal agents",
    personalAgentsDescription:
      "Let members register their own agent endpoints.",
    defaultAgent: "Default agent for new chats",
    noDefault: "No default",
    saveSettings: "Save settings",
    settingsSaved: "Settings saved. Reload to see branding changes.",
    member: "Member",
    role: "Role",
    status: "Status",
    active: "active",
    banned: "banned",
    manageUser: "Manage {email}",
    demoteToUser: "Demote to user",
    makeAdmin: "Make admin",
    ban: "Ban",
    unban: "Unban",
    deleteAccount: "Delete account",
    deleteUserConfirmation:
      "Delete {email} and all their data? This cannot be undone.",
    copied: "Copied",
    copy: "Copy",
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    arguments: "Arguments",
    result: "Result",
    dialog: "Dialog",
    agentNameExample: "My Research Agent",
    agentDescriptionExample: "What is this agent good at?",
    optionalInstructions:
      "Optional system instructions sent with every request",
    apiKeyStorageDescription:
      "Sent as Authorization: Bearer ... and stored encrypted.",
    logoUrlPlaceholder:
      "https://.../logo.svg (leave empty for the default mark)",
    thoughtForSeconds: "Thought for {duration} second{suffix}",
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
    appearance: "Apariencia",
    behavior: "Comportamiento",
    profile: "Perfil",
    currentPassword: "Contraseña actual",
    newPassword: "Contraseña nueva",
    save: "Guardar",
    changing: "Cambiando...",
    changePassword: "Cambiar contraseña",
    showReasoning: "Mostrar razonamiento",
    reasoningDescription:
      "Mantiene el razonamiento del agente expandido de forma predeterminada. Al desactivarlo, permanece contraído hasta que lo expandas.",
    nameUpdated: "Nombre actualizado.",
    passwordChanged: "Contraseña actualizada.",
    couldNotUpdateName: "No se pudo actualizar el nombre.",
    couldNotChangePassword: "No se pudo cambiar la contraseña.",
    agentsDescription:
      "Conecta endpoints que usan el protocolo Open Responses y chatea con ellos.",
    noAgentsYet: "Aún no hay agentes",
    addFirstAgent:
      "Añade tu primer endpoint de Open Responses para empezar a chatear.",
    chatWith: "Chatear con {name}",
    edit: "Editar {name}",
    delete: "Eliminar {name}",
    agentDeleted: "Agente eliminado.",
    deleteAgentConfirmation:
      '¿Eliminar "{name}"? Sus conversaciones se conservarán, pero ya no podrán continuar.',
    editAgent: "Editar agente",
    importAgentCard: "Importar desde tarjeta de agente",
    import: "Importar",
    fetching: "Obteniendo...",
    agentCardHelp:
      "Obtiene /.well-known/agent-card.json (tarjeta de agente A2A) y completa el formulario, incluida la URL de Open Responses.",
    agentCardImported:
      "Tarjeta de agente importada. Revisa los campos siguientes y guarda los cambios.",
    agentCardMissingInterface:
      "La tarjeta se importó, pero no declara una interfaz de Open Responses. Introduce la URL base manualmente.",
    description: "Descripción",
    avatar: "Avatar",
    baseUrl: "URL base",
    apiKey: "Clave de API",
    model: "Modelo",
    instructions: "Instrucciones",
    conversationState: "Estado de la conversación",
    fileDelivery: "Entrega de archivos",
    imageInput: "Entrada de imágenes",
    fileInput: "Entrada de archivos",
    enabled: "Activado",
    sharedWithEveryone: "Compartido con todos",
    saveChanges: "Guardar cambios",
    saving: "Guardando...",
    syncing: "Sincronizando...",
    resync: "Volver a sincronizar",
    agentUpdated: "Agente actualizado.",
    agentCreated: "Agente creado.",
    extraParametersMustBeJson:
      "Los parámetros adicionales deben ser un objeto JSON.",
    optionalBearerToken: "Token de portador opcional",
    optional: "opcional",
    replayTranscript: "Reproducir transcripción (sin estado)",
    agentStoresState: "previous_response_id (el agente guarda el estado)",
    capabilityUrlDelivery: "URL de capacidad (el agente la obtiene de Parley)",
    inlineFileDelivery: "Base64 en línea (el agente no puede acceder a Parley)",
    personalAgentsDisabled:
      "Los agentes personales están desactivados en esta instalación.",
    conversationNotFound: "Esta conversación no existe.",
    startNewChat: "Iniciar un nuevo chat",
    navigation: "Navegación",
    openSidebar: "Abrir barra lateral",
    collapseSidebar: "Contraer barra lateral",
    expandSidebar: "Expandir barra lateral",
    saveName: "Guardar nombre",
    cancelRename: "Cancelar cambio de nombre",
    chatOptions: "Opciones del chat",
    close: "Cerrar",
    pinned: "Fijado",
    unpin: "Desfijar",
    pinToCanvas: "Fijar al lienzo",
    unpinToShowInline: "Desfijar para mostrar en línea",
    pinnedToCanvas: "Fijado al lienzo",
    filter: "Filtrar...",
    adminDescription: "Administra esta instalación: marca, acceso y miembros.",
    brandingAccess: "Marca y acceso",
    catalogs: "Catálogos",
    members: "Miembros",
    installedCatalogPlugins: "Complementos de catálogo instalados",
    catalogPluginsDescription:
      "Estos renderizadores de confianza están instalados en esta versión de Parley. Al desactivar uno, se muestra la respuesta de texto de la herramienta en vez de su interfaz.",
    builtIn: "Integrado",
    catalogId: "ID del catálogo",
    enable: "Activar {name}",
    disable: "Desactivar {name}",
    saveCatalogs: "Guardar catálogos",
    catalogSettingsSaved: "Configuración de catálogos guardada.",
    openCatalogId: "Abrir ID del catálogo",
    copyCatalogId: "Copiar ID del catálogo",
    catalogIdCopied: "ID del catálogo copiado",
    branding: "Marca",
    appName: "Nombre de la aplicación",
    tagline: "Eslogan",
    logoUrl: "URL del logotipo",
    composerDisclaimer: "Aviso del compositor",
    themeCss: "CSS del tema",
    access: "Acceso",
    openRegistration: "Registro abierto",
    openRegistrationDescription:
      "Permite que cualquiera cree una cuenta en esta instalación.",
    personalAgents: "Agentes personales",
    personalAgentsDescription:
      "Permite que los miembros registren sus propios endpoints de agente.",
    defaultAgent: "Agente predeterminado para chats nuevos",
    noDefault: "Sin predeterminado",
    saveSettings: "Guardar configuración",
    settingsSaved:
      "Configuración guardada. Recarga para ver los cambios de marca.",
    member: "Miembro",
    role: "Rol",
    status: "Estado",
    active: "activo",
    banned: "bloqueado",
    manageUser: "Administrar {email}",
    demoteToUser: "Quitar rol de administrador",
    makeAdmin: "Hacer administrador",
    ban: "Bloquear",
    unban: "Desbloquear",
    deleteAccount: "Eliminar cuenta",
    deleteUserConfirmation:
      "¿Eliminar {email} y todos sus datos? Esta acción no se puede deshacer.",
    copied: "Copiado",
    copy: "Copiar",
    pending: "Pendiente",
    running: "En ejecución",
    completed: "Completado",
    arguments: "Argumentos",
    result: "Resultado",
    dialog: "Diálogo",
    agentNameExample: "Mi agente de investigación",
    agentDescriptionExample: "¿Para qué sirve este agente?",
    optionalInstructions:
      "Instrucciones opcionales del sistema enviadas con cada solicitud",
    apiKeyStorageDescription:
      "Se envía como Authorization: Bearer ... y se almacena cifrada.",
    logoUrlPlaceholder:
      "https://.../logo.svg (déjalo vacío para usar la marca predeterminada)",
    thoughtForSeconds: "Razonó durante {duration} segundo{suffix}",
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
