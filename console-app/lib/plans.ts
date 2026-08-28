export const PLANS = {
  trial:      { name: 'Free Trial',  price: 0,    maxUsers: 3,   features: ['3 users', '5 GB storage/user', 'Basic support'] },
  starter:    { name: 'Starter',     price: 499,  maxUsers: 10,  features: ['10 users', '15 GB storage/user', 'Email support', 'Custom domain'] },
  business:   { name: 'Business',    price: 1499, maxUsers: 50,  features: ['50 users', '50 GB storage/user', 'Priority support', 'Custom domain', 'Team aliases'] },
  enterprise: { name: 'Enterprise',  price: 3999, maxUsers: 999, features: ['Unlimited users', '100 GB storage/user', 'Dedicated support', 'SLA', 'Custom DKIM'] },
} as const;

export type PlanKey = keyof typeof PLANS;
