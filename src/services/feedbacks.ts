export interface Feedback {
  id: string;
  date: string;
  client: string;
  room: string;
  comment: string;
  rating: number;
}

export async function getFeedbacks(): Promise<Feedback[]> {
  return [];
}
