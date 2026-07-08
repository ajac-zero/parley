import { queryOptions } from "@tanstack/react-query";
import { getAdminSettings, listUsers } from "~/functions/admin";
import { listAgents } from "~/functions/agents";
import { getConversation, listConversations } from "~/functions/conversations";

export const conversationsQuery = () =>
  queryOptions({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
  });

export const conversationQuery = (conversationId: string) =>
  queryOptions({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation({ data: { conversationId } }),
  });

export const agentsQuery = () =>
  queryOptions({
    queryKey: ["agents"],
    queryFn: () => listAgents(),
  });

export const usersQuery = () =>
  queryOptions({
    queryKey: ["admin", "users"],
    queryFn: () => listUsers(),
  });

export const adminSettingsQuery = () =>
  queryOptions({
    queryKey: ["admin", "settings"],
    queryFn: () => getAdminSettings(),
  });
