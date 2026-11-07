export interface Ticket {
  ticketId: string;
  subject: string;
  description: string;
  status: string;
  requester: string;
  email: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
  // Lowercased copies for search
  subjectLower: string;
  descriptionLower: string;
  requesterLower: string;
  emailLower: string;
}

export interface SearchParams {
  q?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  lastKey?: string;
}

export interface SearchResult {
  items: Ticket[];
  count: number;
  nextKey: string | null;
}
