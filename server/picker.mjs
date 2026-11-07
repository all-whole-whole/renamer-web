// Native file/folder dialogs.
//
// The browser cannot hand us absolute paths (a dropped File exposes only a name),
// so the host raises real Win32 dialogs through Windows PowerShell + WinForms.
// Three details matter and are easy to get wrong:
//   1. Per-Monitor V2 DPI awareness, or the dialog is bitmap-stretched on 150%+.
//   2. An invisible *sized* owner window (640x420, TopMost). No owner => the
//      dialog can open behind the browser; a 1x1 owner => the dialog is dragged
//      to the top-left corner by DWM.
//   3. Strict UTF-8 on the pipe, with a GBK fallback for legacy code pages.
//
// Folder selection uses IFileOpenDialog with FOS_PICKFOLDERS +
// FOS_ALLOWMULTISELECT. FolderBrowserDialog is kept only as a fallback because
// it can select exactly one folder and cannot multi-select.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export const PS_SCRIPT = String.raw`param([string]$Kind = 'files')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace RwDpi -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@

$dpiOk = $false
try { $dpiOk = [RwDpi.Api]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { $dpiOk = $false }
if (-not $dpiOk) { try { [void][RwDpi.Api]::SetProcessDPIAware() } catch { } }

$folderPickerReady = $false
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace RwFolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    public class FileOpenDialogRCW { }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItemArray
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetPropertyStore(uint flags, ref Guid riid, out IntPtr ppv);
        void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
        void GetAttributes(uint attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
        void GetCount(out uint pdwNumItems);
        void GetItemAt(uint dwIndex, out IShellItem ppsi);
        void EnumItems(out IntPtr ppenumShellItems);
    }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr hwndParent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IShellItemArray ppenum);
        void GetSelectedItems(out IShellItemArray ppsai);
    }

    public static class MultiFolderPicker
    {
        public static string[] Pick(IntPtr owner, string title)
        {
            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | 0x20u | 0x40u | 0x200u | 0x800u);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);

            if (dialog.Show(owner) != 0) return new string[0];

            IShellItemArray results;
            dialog.GetResults(out results);
            uint count;
            results.GetCount(out count);
            var paths = new string[count];
            for (uint i = 0; i < count; i++)
            {
                IShellItem item;
                results.GetItemAt(i, out item);
                string path;
                item.GetDisplayName(0x80058000u, out path);
                paths[i] = path;
            }
            return paths;
        }
    }
}
'@
  $folderPickerReady = $true
} catch {
  $folderPickerReady = $false
}

$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'renamer-web'
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(640, 420)
$owner.Show()
[void]$owner.Activate()

$paths = @()
try {
  if ($Kind -eq 'folders') {
    if ($folderPickerReady) {
      try {
        $picked = [RwFolderPicker.MultiFolderPicker]::Pick($owner.Handle, '选择文件夹（Ctrl+单击可多选）')
        if ($picked -and $picked.Count -gt 0) { $paths = @($picked) }
      } catch {
        $folderPickerReady = $false
      }
    }
    if (-not $folderPickerReady) {
      $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
      $dlg.Description = '选择文件夹'
      $dlg.ShowNewFolderButton = $true
      if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $paths = @($dlg.SelectedPath) }
    }
  } elseif ($Kind -eq 'save') {
    $dlg = New-Object System.Windows.Forms.SaveFileDialog
    $dlg.Filter = 'All files (*.*)|*.*'
    $dlg.OverwritePrompt = $true
    if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $paths = @($dlg.FileName) }
  } else {
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Multiselect = $true
    $dlg.Filter = 'All files (*.*)|*.*'
    if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $paths = @($dlg.FileNames) }
  }
} finally {
  $owner.Close()
  $owner.Dispose()
}

$payload = @{ ok = ($paths.Count -gt 0); kind = $Kind; paths = @($paths) }
$payload | ConvertTo-Json -Compress -Depth 4
`;

let busy = false;

function decodeStrict(buffer) {
  const bytes = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return bytes.toString('utf8');
    }
  }
}

export function pickerAvailable() {
  return process.platform === 'win32';
}

/**
 * @param {'files'|'folders'|'save'} kind
 * @returns {Promise<{ok:boolean, kind:string, paths:string[]}>}
 */
export async function pick(kind = 'files') {
  if (process.platform !== 'win32') throw new Error('原生对话框仅支持 Windows');
  if (busy) throw new Error('已有一个选择对话框处于打开状态');
  if (!['files', 'folders', 'save'].includes(kind)) throw new Error(`未知的对话框类型: ${kind}`);

  busy = true;
  const scriptPath = join(tmpdir(), `renamer-web-pick-${randomUUID()}.ps1`);
  try {
    await fs.writeFile(scriptPath, `\ufeff${PS_SCRIPT}`, 'utf8');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Kind', kind],
      { encoding: 'buffer', windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 * 1024, cwd: tmpdir() },
    );
    const text = decodeStrict(Buffer.from(stdout)).trim();
    if (!text) return { ok: false, kind, paths: [] };
    const parsed = JSON.parse(text);
    const paths = Array.isArray(parsed.paths) ? parsed.paths.filter((p) => typeof p === 'string' && p) : [];
    return { ok: Boolean(parsed.ok) && paths.length > 0, kind, paths };
  } finally {
    busy = false;
    await fs.rm(scriptPath, { force: true }).catch(() => {});
  }
}
