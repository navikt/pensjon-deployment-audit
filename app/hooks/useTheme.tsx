import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type ThemeValue = 'light' | 'dark'

const STORAGE_KEY = 'pensjon-deployment-audit-theme'

interface ThemeContextType {
  theme: ThemeValue
  toggleTheme: () => void
  isLoaded: boolean
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeValue>('light')
  const [isLoaded, setIsLoaded] = useState(false)

  // Load theme from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeValue | null
    if (stored === 'light' || stored === 'dark') {
      setThemeState(stored)
    }
    setIsLoaded(true)
  }, [])

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEY, newTheme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, toggleTheme, isLoaded }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
