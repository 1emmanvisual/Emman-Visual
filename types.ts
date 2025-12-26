
export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string;
  category: 'Pastries' | 'Main Course' | 'Drinks' | 'Desserts';
  image: string;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string;
}

export interface Reservation {
  name: string;
  date: string;
  time: string;
  guests: number;
  phone?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export type Gender = 'Male' | 'Female' | 'Either';
export type AgeGroup = 'Young' | 'Old' | 'Baby';

export interface CustomerPersona {
  gender: Gender;
  age: AgeGroup;
}

export interface AppState {
  isCalling: boolean;
  order: OrderItem[];
  reservation: Reservation | null;
  chatHistory: ChatMessage[];
  isThinking: boolean;
  handoffRequested: boolean;
  persona: CustomerPersona;
  logs: string[]; // For simulating POS/WhatsApp/Kitchen notifications
}
