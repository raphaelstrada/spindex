import { useEffect, useState } from 'react'
import { Barcode, Disc3, Hash, Images, LogOut, Moon, PenLine, Settings, Sun } from 'lucide-react'
import { RecordForm } from '@/components/RecordForm'
import { PhotoRecordImport } from '@/components/PhotoRecordImport'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { BarcodeRecordImport } from '@/components/BarcodeRecordImport'
import { CatalogNumberRecordImport } from '@/components/CatalogNumberRecordImport'
import { DataTable, type AdminView } from '@/components/DataTable'
import { DiscogsVerification } from '@/components/DiscogsVerification'
import { OrdersDialog } from '@/components/OrdersDialog'
import { ShippingSettingsDialog } from '@/components/ShippingSettingsDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { translations, type Language } from '@/lib/i18n'
import { Logo } from '@/components/Logo'
import { supabase } from '@/lib/supabase'

type AddRecordPath = 'picture' | 'catalogNumber' | 'discogsUrl' | 'manual' | 'barcode' | null

export default function AdminPage() {
  const [isOpen, setIsOpen] = useState(false)
  const [isPhotoImportOpen, setIsPhotoImportOpen] = useState(false)
  const [addRecordPath, setAddRecordPath] = useState<AddRecordPath>(null)
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [recordsVersion, setRecordsVersion] = useState(0)
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem('spindex-language') === 'pt' ? 'pt' : 'en',
  )
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    window.localStorage.getItem('spindex-theme') === 'light' ? 'light' : 'dark',
  )
  const [view, setView] = useState<AdminView>(() =>
    window.localStorage.getItem('spindex-admin-view') === 'sales' ? 'sales' : 'inventory',
  )
  const t = translations[language]

  useEffect(() => {
    window.localStorage.setItem('spindex-admin-view', view)
  }, [view])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('spindex-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.app.title
    window.localStorage.setItem('spindex-language', language)
  }, [language, t.app.title])

  function closeAddRecordDialog() {
    setIsOpen(false)
    setAddRecordPath(null)
    setScannedBarcode(null)
    setBarcodeError(null)
  }

  function handleRecordAdded() {
    closeAddRecordDialog()
    setRecordsVersion((version) => version + 1)
  }

  return (
    <div className="container mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 2xl:px-8">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>
            <Logo />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.app.description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
          <div role="group" aria-label={t.app.adminView} className="inline-flex rounded-md border p-0.5">
            {(['inventory', 'sales'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={view === option ? 'default' : 'ghost'}
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option === 'inventory' ? t.app.viewInventory : t.app.viewSales}
              </Button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t.app.settingsMenu} title={t.app.settingsMenu}>
                <Settings aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                {theme === 'dark' ? t.app.switchToLightMode : t.app.switchToDarkMode}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t.app.changeLanguage}</DropdownMenuLabel>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => supabase.auth.signOut()}>
                <LogOut aria-hidden="true" />
                {t.auth.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {view === 'sales' && (
            <>
              <OrdersDialog language={language} />
              <ShippingSettingsDialog language={language} />
            </>
          )}
          {/* Visible in both views so the background verification keeps running when the view changes. */}
          <DiscogsVerification language={language} onRecordsChanged={() => setRecordsVersion((version) => version + 1)} />
          {view === 'inventory' && (
          <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setAddRecordPath(null)
              setScannedBarcode(null)
              setBarcodeError(null)
            }
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
                    onClick={() => setAddRecordPath('catalogNumber')}
                  >
                    <Hash aria-hidden="true" className="h-6 w-6 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{t.app.addRecordPathCatalogNumber}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{t.app.addRecordPathCatalogNumberHint}</span>
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
                    onClick={() => setAddRecordPath('barcode')}
                  >
                    <Barcode aria-hidden="true" className="h-6 w-6 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{t.app.addRecordPathBarcode}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{t.app.addRecordPathBarcodeHint}</span>
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
              ) : addRecordPath === 'catalogNumber' ? (
                <CatalogNumberRecordImport language={language} onSuccess={handleRecordAdded} onSkip={closeAddRecordDialog} />
              ) : addRecordPath === 'barcode' && scannedBarcode ? (
                <BarcodeRecordImport
                  key={scannedBarcode}
                  language={language}
                  barcode={scannedBarcode}
                  onRescan={() => {
                    setScannedBarcode(null)
                    setBarcodeError(null)
                  }}
                  onSuccess={handleRecordAdded}
                  onSkip={closeAddRecordDialog}
                />
              ) : addRecordPath === 'barcode' ? (
                <div className="py-2">
                  <BarcodeScanner
                    language={language}
                    onScan={(code) => {
                      setScannedBarcode(code)
                      setBarcodeError(null)
                    }}
                    onError={(message) => setBarcodeError(message)}
                  />
                  {barcodeError && (
                    <p className="mt-2 text-sm text-destructive" role="alert">
                      {t.app.barcodeError} {barcodeError}
                    </p>
                  )}
                </div>
              ) : (
                <RecordForm
                  language={language}
                  startWithDiscogsUrl={addRecordPath === 'discogsUrl'}
                  onSuccess={handleRecordAdded}
                  onSkip={closeAddRecordDialog}
                />
              )}
            </DialogContent>
          </Dialog>
          )}
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
      <DataTable language={language} recordsVersion={recordsVersion} view={view} />
    </div>
  )
}
