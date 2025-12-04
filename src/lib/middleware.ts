import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, UserRole } from './auth';

export interface AuthRequest extends NextRequest {
  user?: {
    id: string;
    login: string;
    name: string;
    role: UserRole;
  };
}

export async function requireAuth(
  request: NextRequest,
  allowedRoles?: UserRole[]
): Promise<{ user: any } | NextResponse> {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Требуется авторизация' },
      { status: 401 }
    );
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'Недостаточно прав доступа' },
      { status: 403 }
    );
  }

  return { user };
}

export function canAccessTab(role: UserRole, tab: 'new' | 'processed'): boolean {
  if (role === 'admin') {
    return true;
  }
  if (role === 'collector') {
    return tab === 'new';
  }
  if (role === 'checker') {
    return tab === 'new' || tab === 'processed';
  }
  return false;
}

export function canAccessStatus(role: UserRole, status: string): boolean {
  if (role === 'admin') {
    return true;
  }
  if (role === 'collector') {
    return status === 'new';
  }
  if (role === 'checker') {
    return status === 'new' || status === 'pending_confirmation';
  }
  return false;
}

