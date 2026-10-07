import { useEffect, useState } from 'react'
import { Disc3, Images, Moon, PenLine, Sun } from 'lucide-react'
import { RecordForm } from '@/components/RecordForm'
import { PhotoRecordImport } from '@/components/PhotoRecordImport'
import { DataTable } from '@/components/DataTable'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { translations, type Language } from '@/lib/i18n'
import { Logo } from '@/components/Logo'

type AddRecordPath = 'picture' | 'discogsUrl' | 'manual' | null

export default function App() {
  const [isOpen, setIsOpen] = useState(false)
  const [isPhotoImportOpen, setIsPhotoImportOpen] = useState(false)
  const [addRecordPath, setAddRecordPath] = useState<AddRecordPath>(null)
  const [recordsVersion, setRecordsVersion] = useState(0)
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem('spindex-language') === 'pt' ? 'pt' : 'en',
  )
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    window.localStorage.getItem('spindex-theme') === 'light' ? 'light' : 'dark',
  )
  const t = translations[language]

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('spindex-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.app.title
    window.localStorage.setItem('spindex-language', language)
  }, [language, t.app.title])

  return (
    <div className="container mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 2xl:px-8">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>
            <Logo />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.app.description}</p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <Button
            variant="outline"
            size="icon"
            aria-label={theme === 'dark' ? t.app.switchToLightMode : t.app.switchToDarkMode}
            title={theme === 'dark' ? t.app.switchToLightMode : t.app.switchToDarkMode}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t.app.changeLanguage}
                title={t.app.changeLanguage}
              >
                <span aria-hidden="true">{language === 'en' ? '🇬🇧' : '🇧🇷'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={language}
                onValueChange={(value) => setLanguage(value as Language)}
              >
                <DropdownMenuRadioItem value="en">
                  <span aria-hidden="true">🇬🇧</span>
                  {t.app.english}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="pt">
                  <span aria-hidden="true">🇧🇷</span>
                  {t.app.portuguese}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) setAddRecordPath(null)
          }}>
            <DialogTrigger asChild>
              <Button>{t.app.addRecord}</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>
                  {addRecordPath === null ? t.app.addRecordPathTitle : t.app.dialogTitle}
                </DialogTitle>
              </DialogHeader>
              {addRecordPath === null ? (
                <div className="grid gap-3 py-2">
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setIsOpen(false)
                      setIsPhotoImportOpen(true)
                    }}
                  >
                    <Images aria-hidden="true" className="h-6 w-6 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{t.app.addRecordPathPicture}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{t.app.addRecordPathPictureHint}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setAddRecordPath('discogsUrl')}
                  >
                    <Disc3 aria-hidden="true" className="h-6 w-6 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{t.app.addRecordPathDiscogsUrl}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{t.app.addRecordPathDiscogsUrlHint}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setAddRecordPath('manual')}
                  >
                    <PenLine aria-hidden="true" className="h-6 w-6 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{t.app.addRecordPathManual}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{t.app.addRecordPathManualHint}</span>
                    </span>
                  </button>
                </div>
              ) : (
                <RecordForm
                  language={language}
                  startWithDiscogsUrl={addRecordPath === 'discogsUrl'}
                  onSuccess={() => {
                    setIsOpen(false)
                    setAddRecordPath(null)
                    setRecordsVersion((version) => version + 1)
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
          <Dialog open={isPhotoImportOpen} onOpenChange={setIsPhotoImportOpen}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>{t.app.uploadPicture}</DialogTitle>
              </DialogHeader>
              <PhotoRecordImport
                language={language}
                onRecordSaved={() => setRecordsVersion((version) => version + 1)}
                onClose={() => setIsPhotoImportOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <DataTable language={language} recordsVersion={recordsVersion} />
    </div>
  )
}
