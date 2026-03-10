export interface ServiceItem {
  id: string;
  title: string;
  duration: number; // in minutes
  order: number;
}

export interface ServiceType {
  id: string;
  name: string;
  startTime: string; // e.g., "09:00"
  endTime: string;   // e.g., "11:00"
  duration: number;  // total service duration in minutes (calculated or manual)
}

export type ServiceStatus = 'running' | 'paused' | 'idle';

export interface ServiceState {
  activeItemId: string | null;
  activeServiceTypeId: string | null;
  startTime: number | null; // timestamp in ms for the current item
  serviceStartTime: number | null; // timestamp in ms for the whole service
  status: ServiceStatus;
  remainingSeconds: number; // for the current item
}

export interface ServiceLog {
  id?: string;
  date: string; // ISO date string
  serviceType: string;
  activityName: string;
  startTime: number; // timestamp
  endTime: number; // timestamp
  durationSeconds: number;
  totalServiceStartTime: number | null;
}
