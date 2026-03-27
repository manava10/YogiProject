/**
 * Single place for "where should this role land after login?"
 * Used by Login, Register, Vendor auth, Google sign-in, and deep links.
 */
export function getDashboardPathForRole(role) {
    if (!role) return '/dashboard';
    switch (role) {
        case 'admin':
            return '/superadmin';
        case 'vendor':
            return '/vendordashboard';
        case 'rider':
        case 'deliveryadmin':
            return '/rider';
        case 'user':
        default:
            return '/dashboard';
    }
}
