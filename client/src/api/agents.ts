import { http } from "./http";
import type {
  AgentConversation,
  AgentMemoryNote,
  AgentName,
  ChatMessage,
  ChatResponse,
} from "@shared/types";

export const agentsApi = {
  status: () => http.get<{ enabled: boolean }>("/api/agents/status"),
  conversations: (agent: AgentName) =>
    http.get<AgentConversation[]>(`/api/agents/${agent}/conversations`),
  messages: (conversationId: number) =>
    http.get<ChatMessage[]>(`/api/agents/conversations/${conversationId}/messages`),
  deleteConversation: (conversationId: number) =>
    http.del<{ ok: boolean }>(`/api/agents/conversations/${conversationId}`),
  memory: (agent: AgentName) => http.get<AgentMemoryNote[]>(`/api/agents/${agent}/memory`),
  chat: (agent: AgentName, message: string, conversationId?: number) =>
    http.post<ChatResponse>(`/api/agents/${agent}/chat`, { message, conversationId }),
};
