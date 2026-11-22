/** 首次进入引导只在第一次成功启动后出现一次；按设备保存。 */
const ONBOARDING_KEY = 'stardock.onboarding.v1'

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'done'
  } catch {
    return false
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done')
  } catch {
    /* 隐私模式或存储被禁用时，下一次启动还会再引导一遍 */
  }
}
