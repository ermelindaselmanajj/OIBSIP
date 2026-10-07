export function verificationProfile(data) {
  const admin = data?.admin;
  if (!admin || admin.role !== 'admin' || typeof admin.email !== 'string' || !admin.email || typeof admin.isVerified !== 'boolean') {
    throw new Error('Your email verification status could not be read. Please try again.');
  }
  return admin;
}

export function verificationNotice(data) {
  if (typeof data?.message !== 'string' || !data.message || typeof data.isVerified !== 'boolean') {
    throw new Error('The verification response could not be read. Refresh your email status before trying again.');
  }
  return { text: data.message, isVerified: data.isVerified };
}

export function verificationLinkNotice(result) {
  if (result === 'success') return { success: true, text: 'Your administrator email is verified. Sign in to manage inventory and receive low-stock alerts.' };
  if (result === 'invalid') return { success: false, text: 'This verification link is invalid, expired, or already used. Sign in to check your email status or request a new link.' };
  return null;
}
