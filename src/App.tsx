import { useEffect, useState } from 'react'
import { Images } from 'lucide-react'
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

export default function App() {
  const [isOpen, setIsOpen] = useState(false)
  const [isPhotoImportOpen, setIsPhotoImportOpen] = useState(false)
  const [recordsVersion, setRecordsVersion] = useState(0)
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem('vinyl-catalog-language') === 'pt' ? 'pt' : 'en',
  )
  const t = translations[language]

  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.app.title
    window.localStorage.setItem('vinyl-catalog-language', language)
  }, [language, t.app.title])

  return (
    <div className="container mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 2xl:px-8">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{t.app.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.app.description}</p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
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
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">{t.app.addRecord}</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{t.app.dialogTitle}</DialogTitle>
              </DialogHeader>
              <RecordForm
                language={language}
                onUploadPicture={() => {
                  setIsOpen(false)
                  setIsPhotoImportOpen(true)
                }}
                onSuccess={() => {
                  setIsOpen(false)
                  setRecordsVersion((version) => version + 1)
                }}
              />
            </DialogContent>
          </Dialog>
          <Dialog open={isPhotoImportOpen} onOpenChange={setIsPhotoImportOpen}>
            <DialogTrigger asChild>
              <Button>
                <Images aria-hidden="true" />
                {t.app.uploadPicture}
              </Button>
            </DialogTrigger>
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
