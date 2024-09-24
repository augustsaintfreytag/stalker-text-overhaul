import { DOMParser, XMLSerializer } from "@xmldom/xmldom"
import { encode as encodeToWindows1251, decode as decodeFromWindows1251 } from "windows-1251"
import "typeswift"

// Library

type Path = string

enum FileKind {
	Base = "base",
	LLMC = "llmc",
	IAM = "iam",
	AAM = "aam",
	AAC = "aac"
}

// Configuration

const basePath = "E:/Games/Stalker GAMMA MO2/mods/ZZZ- Saint's Text Overhaul/gamedata/configs/text/eng"

const filePathsByKind: Record<FileKind, Path> = {
	[FileKind.Base]: "zzz_st_saint_items_artefacts.xml",
	[FileKind.LLMC]: "zzz_st_saint_items_container_llmc.xml",
	[FileKind.IAM]: "zzz_st_saint_items_container_iam.xml",
	[FileKind.AAM]: "zzz_st_saint_items_container_aam.xml",
	[FileKind.AAC]: "zzz_st_saint_items_container_aac.xml"
}

const containerKinds: FileKind[] = [FileKind.LLMC, FileKind.IAM, FileKind.AAM, FileKind.AAC]

// State

const parser = new DOMParser()
const serializer = new XMLSerializer()

const fileDocumentsByKind = new Map<FileKind, Document>()

// I/O

async function fileDocumentForKind(kind: FileKind): Promise<Document> {
	if (fileDocumentsByKind.has(kind)) {
		return fileDocumentsByKind.get(kind)!
	}

	const fileContents = await Bun.file(`${basePath}/${filePathsByKind[kind]}`, { type: "text/xml;charset=windows-1251" }).text()
	const fileDocument = parser.parseFromString(fileContents, "text/xml;charset=windows-1251")

	fileDocumentsByKind.set(kind, fileDocument)

	return fileDocument
}

// Processing

async function readArtefactIds(): Promise<Set<string>> {
	const baseDocument = await fileDocumentForKind(FileKind.Base)

	const sample = Array.from(baseDocument.getElementsByTagName("string"))
	const artefactIds = new Set(sample.map(element => {
		const id = element.getAttribute("id")

		if (!id?.includes("_descr")) {
			return undefined
		}
		
		return id.replace(/st_/, "").replace(/(.+)(_descr|_name)/, "$1")
	}).filter(id => id)) as Set<string>

	return artefactIds
}

async function process() {
	const artefactIds = await readArtefactIds()
	console.log(`Read artefact ids: ${Array.from(artefactIds).join(", ")}.`)

	const baseDocument = await fileDocumentForKind(FileKind.Base)

	for (const artefactId of artefactIds) {
		const baseName = nameForId(baseDocument, artefactId)
		const { baseDescription, propertiesDescription: basePropertiesDescription } = descriptionPropertiesForKindAndId(baseDocument, FileKind.Base, artefactId)
		const artefactIsUncontainable = basePropertiesDescription.includes("uncontainable")

		if (artefactIsUncontainable) {
			continue
		}

		for (const containerKind of containerKinds) {
			console.log(`Processing descriptions for '${baseName}' artefact (${containerKind}).`)

			const containerDocument = await fileDocumentForKind(containerKind)
			const { textElement, propertiesDescription } = descriptionPropertiesForKindAndId(containerDocument, containerKind, artefactId)
			const propertiesDescriptionExtension = contentPropertiesFromBaseDescription(basePropertiesDescription)

			const updatedDescription = `${descriptionForContainerWithKind(containerKind, baseName, baseDescription)}\\n \\n\n\t\t${propertiesDescription} \\n\n${propertiesDescriptionExtension}`
			textElement!.textContent = updatedDescription
		}
	}

	for (const kind of containerKinds) {
		const document = fileDocumentsByKind.get(kind)!
		const encodedContents = serializer.serializeToString(document)

		await Bun.write(`${basePath}/${filePathsByKind[kind]}`, encodedContents)
	}
}

function nameForId(document: Document, artefactId: string): string {
	const nameElementId = `st_${artefactId}_name`
	const name = document.getElementById(nameElementId)?.textContent?.trim()

	return name ?? "Unknown Name"
}

function descriptionPropertiesForKindAndId(document: Document, kind: FileKind, artefactId: string) {
	const elementId = stringIdentifierForKind(kind, artefactId)
	const stringElement = document.getElementById(elementId)

	if (!stringElement) {
		throw new Error(`Document for kind '${kind}' and artefact '${artefactId}' does not have a string element for id '${elementId}'.`)
	}

	const textElement = stringElement.getElementsByTagName("text")[0]

	if (!textElement) {
		throw new Error(`Document for kind '${kind}' and artefact '${artefactId}' does not have a text element in string element for id '${elementId}'.`)
	}

	const fullDescription = textElement?.textContent ?? ""

	const descriptionBlocks = fullDescription.split("\\n \\n")

	if (descriptionBlocks.length == 1) {
		const baseDescription = ""
		const propertiesDescription = descriptionBlocks[0]?.trim()

		return { textElement, baseDescription, propertiesDescription }
	}
	
	const baseDescription = descriptionBlocks[0]?.trim()
	const propertiesDescription = postprocessPropertiesDescription(descriptionBlocks[1]?.trim())

	return { textElement, baseDescription, propertiesDescription }
}

function postprocessPropertiesDescription(description: string): string {
	return description
		.replace(/%c\[ui_gray_2\]PROPERTIES/, "%c[ui_gray_3]PROPERTIES")
		.replace(/(.+valuable.+\n)/, "")
		.replace(/(.+permissible.+)\n(.+)\n/, "$2\n$1\n")
		.replace(/(.+maximum capacity.+)\n(.+state.+)\n(.+permissible.+)\n/, "$3\n$1\n$2\n")
}

function contentPropertiesFromBaseDescription(description: string): string {
	const lines = description.split("\n")

	const tierLine = lines[1].replace(/\t/g, "")
	const typeLine = lines[2].replace(/\t/g, "")

	return [
		"\t\t" + "%c[ui_gray_3]CONTENTS:\\n",
		"\t\t" + tierLine,
		"\t\t" + typeLine
	].join("\n")
}

function stringIdentifierForKind(kind: FileKind, id: string): string {
	switch (kind) {
		case FileKind.Base:
			return `st_${id}_descr`
		case FileKind.LLMC:
			return `st_${id}_lead_box_descr`
		case FileKind.AAC:
			return `st_${id}_af_aac_descr`
		case FileKind.AAM:
			return `st_${id}_af_aam_descr`
		case FileKind.IAM:
			return `st_${id}_af_iam_descr`
		default:
			throw new Error(`Kind '${kind}' not supported`)
	}
}

function descriptionForContainerWithKind(kind: FileKind, artefactName: string, baseDescription: string): string {
	switch (kind) {
		case FileKind.LLMC:
			return `A lead-lined metal container (LLMC) holding ${articleForTerm(artefactName)} ${artefactName} artefact, ${lowercaseFirst(baseDescription)}`
		case FileKind.IAM:
			return `An improvised application module (IAM) holding ${articleForTerm(artefactName)} ${artefactName} artefact, ${lowercaseFirst(baseDescription)}`
		case FileKind.AAC:
			return `An artefact application container (AAC) holding ${articleForTerm(artefactName)} ${artefactName} artefact, ${lowercaseFirst(baseDescription)}`
		case FileKind.AAM:
			return `An artefact application module (AAM) holding ${articleForTerm(artefactName)} ${artefactName} artefact, ${lowercaseFirst(baseDescription)}`
		default:
			throw new Error(`Kind '${kind}' not supported`)
	}
}

function articleForTerm(text: string): string {
	const firstLetter = text.substring(0, 1)

	switch (firstLetter.toLowerCase()) {
		case "a":
		case "e":
		case "i":
		case "o":
		case "u":
		case "y":
			return "an"
		default:
			return "a"
	}
}

function lowercaseFirst(text: string): string {
	return text.substring(0, 1).toLowerCase() + text.substring(1)
}

process()