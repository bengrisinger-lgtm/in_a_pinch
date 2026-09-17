import { quoteFetch } from './quoteApi';

export type StaffHire = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  user_id: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
};

export type StaffFieldDef = {
  field_key: string;
  label: string;
  field_type: 'text' | 'date';
  sort_order: number;
};

export type OnboardingStatus = {
  required: boolean;
  hire: Pick<StaffHire, 'id' | 'email' | 'first_name' | 'last_name' | 'phone'> | null;
  profile: Record<string, unknown> | null;
  customFields: StaffFieldDef[];
};

export const PRONOUN_OPTIONS = [
  'he/him',
  'she/her',
  'they/them',
  'he/they',
  'she/they',
] as const;

export function listStaffHires() {
  return quoteFetch<{ hires: StaffHire[] }>('/staff/hires');
}

export function createStaffHire(input: {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}) {
  return quoteFetch<{ hire: StaffHire; next_step: string }>('/staff/hires', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function addStaffProfileField(input: {
  field_key: string;
  label: string;
  field_type?: 'text' | 'date';
}) {
  return quoteFetch<{ field: StaffFieldDef & { id: string } }>('/staff/field-defs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function claimOnboarding(email: string) {
  return quoteFetch<{ hire: StaffHire }>('/staff/onboarding/claim', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function getOnboardingStatus() {
  return quoteFetch<OnboardingStatus>('/staff/onboarding/status');
}

export function completeOnboarding(input: {
  email?: string;
  first_name: string;
  last_name: string;
  phone: string;
  home_address: string;
  preferred_pronouns?: string;
  emergency_contact_first_name: string;
  emergency_contact_last_name: string;
  emergency_contact_relationship: string;
  extra?: Record<string, string>;
}) {
  return quoteFetch<{ success: boolean }>('/staff/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
