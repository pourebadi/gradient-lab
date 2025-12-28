
import { Gradient, GradientStop } from '../../types';

// Helper: Hex to Normalized RGB (0-1)
const hexToRgbNorm = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
};

// --- ASE (Adobe Swatch Exchange) Generator ---
// Reference: http://www.selapa.net/swatches/colors/fileformats.php#adobe_ase

export const generateASE = (stops: GradientStop[]): Blob => {
    // 1. Calculate file size
    // Header: 12 bytes
    // For each block (color):
    //   Block Head: 6 bytes
    //   Name Len: 2 bytes (len + 1)
    //   Name: (len + 1) * 2 bytes
    //   Color Space: 4 bytes
    //   Color Values: 3 * 4 bytes (RGB float)
    //   Type: 2 bytes
    
    const colors = stops.map((s, i) => {
        const { r, g, b } = hexToRgbNorm(s.color);
        const name = `Stop ${i + 1} - ${Math.round(s.offset * 100)}%`;
        return { r, g, b, name };
    });

    let totalSize = 4 + 4 + 4; // Signature (4), Version (4), Block Count (4)
    
    colors.forEach(c => {
        const nameLen = c.name.length + 1; // null terminator
        totalSize += 6; // Block Type (2) + Block Len (4)
        totalSize += 2; // Name Len
        totalSize += nameLen * 2; // Name bytes (UTF-16BE)
        totalSize += 4; // Color Space (RGB )
        totalSize += 12; // Values (3 floats)
        totalSize += 2; // Type
    });

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Signature "ASEF"
    view.setUint8(offset++, 65);
    view.setUint8(offset++, 83);
    view.setUint8(offset++, 69);
    view.setUint8(offset++, 70);

    // Version 1.0
    view.setUint16(offset, 1); offset += 2;
    view.setUint16(offset, 0); offset += 2;

    // Block Count
    view.setUint32(offset, colors.length); offset += 4;

    colors.forEach(c => {
        // Block Type (0x0001 = Color)
        view.setUint16(offset, 1); offset += 2;

        // Calculate Block Length
        const nameLen = c.name.length + 1;
        const blockLen = 2 + (nameLen * 2) + 4 + 12 + 2;
        view.setUint32(offset, blockLen); offset += 4;

        // Name Length
        view.setUint16(offset, nameLen); offset += 2;

        // Name (UTF-16BE)
        for (let i = 0; i < c.name.length; i++) {
            view.setUint16(offset, c.name.charCodeAt(i)); offset += 2;
        }
        view.setUint16(offset, 0); offset += 2; // Null terminator

        // Color Space "RGB "
        view.setUint8(offset++, 82);
        view.setUint8(offset++, 71);
        view.setUint8(offset++, 66);
        view.setUint8(offset++, 32);

        // Values
        view.setFloat32(offset, c.r); offset += 4;
        view.setFloat32(offset, c.g); offset += 4;
        view.setFloat32(offset, c.b); offset += 4;

        // Type (2 = Normal)
        view.setUint16(offset, 2); offset += 2;
    });

    return new Blob([buffer], { type: 'application/octet-stream' });
};

// --- Photoshop JSX Generator ---

export const generatePhotoshopJSX = (gradient: Gradient): string => {
    const type = gradient.type === 'radial' ? 'radial' : 'linear';
    // Photoshop angle: 0 is 3 o'clock (East). CSS 0 is 12 o'clock (North).
    // conversion depends on specific PS version but generally: PS = 90 - CSS
    const psAngle = (90 - gradient.angle) % 360; 

    // Build Stops Descriptor string
    const colorStops = gradient.stops.map(s => {
        const { r, g, b } = hexToRgbNorm(s.color);
        // RGB in PS scripting is often 0-255 or native objects.
        // We will construct an ActionDescriptor logic which is robust.
        return `
            var stop${s.id.replace(/-/g,'')} = new ActionDescriptor();
            var color${s.id.replace(/-/g,'')} = new ActionDescriptor();
            color${s.id.replace(/-/g,'')}.putDouble(charIDToTypeID("Rd  "), ${r * 255});
            color${s.id.replace(/-/g,'')}.putDouble(charIDToTypeID("Grn "), ${g * 255});
            color${s.id.replace(/-/g,'')}.putDouble(charIDToTypeID("Bl  "), ${b * 255});
            stop${s.id.replace(/-/g,'')}.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), color${s.id.replace(/-/g,'')});
            stop${s.id.replace(/-/g,'')}.putInteger(charIDToTypeID("Type"), 0); // UserStop
            stop${s.id.replace(/-/g,'')}.putInteger(charIDToTypeID("Lctn"), ${Math.round(s.offset * 4096)}); // 0-4096 range
            stop${s.id.replace(/-/g,'')}.putInteger(charIDToTypeID("Mdpn"), 50);
            colorsList.putObject(charIDToTypeID("Clrt"), stop${s.id.replace(/-/g,'')});
        `;
    }).join('\n');

    const transparencyStops = gradient.stops.map(s => {
        return `
            var trans${s.id.replace(/-/g,'')} = new ActionDescriptor();
            trans${s.id.replace(/-/g,'')}.putUnitDouble(charIDToTypeID("Opct"), charIDToTypeID("#Prc"), ${ (s.opacity || 1) * 100 });
            trans${s.id.replace(/-/g,'')}.putInteger(charIDToTypeID("Lctn"), ${Math.round(s.offset * 4096)});
            trans${s.id.replace(/-/g,'')}.putInteger(charIDToTypeID("Mdpn"), 50);
            transList.putObject(charIDToTypeID("TrnS"), trans${s.id.replace(/-/g,'')});
        `;
    }).join('\n');

    return `
/* 
   Gradient Architect - Photoshop Import Script
   Usage: File > Scripts > Browse... select this .jsx file.
   It will create a new Fill Layer with the gradient.
*/

try {
    var doc = app.activeDocument;
} catch(e) {
    alert("Please open a document first.");
}

function createGradient() {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(stringIDToTypeID("contentLayer"));
    desc.putReference(charIDToTypeID("null"), ref);
    
    var fillDesc = new ActionDescriptor();
    var gradientDesc = new ActionDescriptor();
    
    gradientDesc.putString(charIDToTypeID("Nm  "), "Imported Gradient");
    gradientDesc.putEnumerated(charIDToTypeID("GrdF"), charIDToTypeID("GrdF"), charIDToTypeID("CstS")); // Custom Solid
    gradientDesc.putDouble(charIDToTypeID("Intr"), 4096.000000);
    
    // Color Stops
    var colorsList = new ActionList();
    ${colorStops}
    gradientDesc.putList(charIDToTypeID("Clrs"), colorsList);
    
    // Transparency Stops
    var transList = new ActionList();
    ${transparencyStops}
    gradientDesc.putList(charIDToTypeID("Trns"), transList);
    
    fillDesc.putObject(charIDToTypeID("Grad"), charIDToTypeID("Grdn"), gradientDesc);
    fillDesc.putUnitDouble(charIDToTypeID("Angl"), charIDToTypeID("#Ang"), ${psAngle});
    fillDesc.putEnumerated(charIDToTypeID("Type"), stringIDToTypeID("gradientType"), stringIDToTypeID("${type}"));
    
    // Create Layer
    var layerDesc = new ActionDescriptor();
    layerDesc.putObject(stringIDToTypeID("type"), stringIDToTypeID("gradientLayer"), fillDesc);
    desc.putObject(charIDToTypeID("Usng"), stringIDToTypeID("contentLayer"), layerDesc);
    
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
}

createGradient();
    `.trim();
};
