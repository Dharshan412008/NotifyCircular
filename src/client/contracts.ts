import { z } from 'zod';

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least two characters.').max(100),
  register_number: z.string().max(50), department: z.string().max(80),
  program: z.string().max(80), section: z.string().max(30),
  academic_year: z.string().max(30), bio: z.string().max(500),
});
export type Profile = z.infer<typeof profileSchema>;
export type Role = 'student' | 'faculty' | 'admin';
export interface SessionUser { id: number; name: string; email: string; role: Role; year: number | null }
export interface SearchResult { id: string; kind: string; title: string; subtitle: string; href: string }
export interface NotificationPreferences { circular: boolean; event: boolean; social: boolean; email: boolean; digest: 'instant' | 'daily' }
