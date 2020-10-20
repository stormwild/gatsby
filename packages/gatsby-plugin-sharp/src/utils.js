import ProgressBar from "progress"
import sharp from "sharp"
// TODO remove in V3
export function createGatsbyProgressOrFallbackToExternalProgressBar(
  message,
  reporter
) {
  if (reporter && reporter.createProgress) {
    return reporter.createProgress(message)
  }

  const bar = new ProgressBar(
    ` [:bar] :current/:total :elapsed s :percent ${message}`,
    {
      total: 0,
      width: 30,
      clear: true,
    }
  )

  return {
    start() {},
    tick(increment = 1) {
      bar.tick(increment)
    },
    done() {},
    set total(value) {
      bar.total = value
    },
  }
}

let progressBar
let pendingImagesCounter = 0
let firstPass = true
export const createOrGetProgressBar = reporter => {
  if (!progressBar) {
    progressBar = createGatsbyProgressOrFallbackToExternalProgressBar(
      `Generating image thumbnails`,
      reporter
    )

    const originalDoneFn = progressBar.done

    // TODO this logic should be moved to the reporter.
    // when done is called we remove the progressbar instance and reset all the things
    // this will be called onPostBuild or when devserver is created
    progressBar.done = () => {
      originalDoneFn.call(progressBar)
      progressBar = null
      pendingImagesCounter = 0
    }

    progressBar.addImageToProcess = imageCount => {
      if (pendingImagesCounter === 0) {
        progressBar.start()
      }
      pendingImagesCounter += imageCount
      progressBar.total = pendingImagesCounter
    }

    // when we create a progressBar for the second time so when .done() has been called before
    // we create a modified tick function that automatically stops the progressbar when total is reached
    // this is used for development as we're watching for changes
    if (!firstPass) {
      let progressBarCurrentValue = 0
      const originalTickFn = progressBar.tick
      progressBar.tick = (ticks = 1) => {
        originalTickFn.call(progressBar, ticks)
        progressBarCurrentValue += ticks

        if (progressBarCurrentValue === pendingImagesCounter) {
          progressBar.done()
        }
      }
    }
    firstPass = false
  }

  return progressBar
}

export const getProgressBar = () => progressBar

export function rgbToHex(red, green, blue) {
  return `#${(blue | (green << 8) | (red << 16) | (1 << 24))
    .toString(16)
    .slice(1)}`
}

const warnForIgnoredParameters = (layout, parameters, filepath, reporter) => {
  const ignoredParams = Object.entries(parameters).filter(([_, value]) =>
    Boolean(value)
  )
  if (ignoredParams.length) {
    reporter.warn(
      `The following provided parameter(s): ${ignoredParams
        .map(param => param.join(`: `))
        .join(
          `, `
        )} for the image at ${filepath} are ignored in ${layout} image layouts.`
    )
  }
  return
}

const DEFAULT_PIXEL_DENSITIES = [0.25, 0.5, 1, 2]
const DEFAULT_FLUID_SIZE = 800

const dedupeAndSortDensities = values =>
  Array.from(new Set([1, ...values])).sort()

export function calculateImageSizes(args) {
  const { width, maxWidth, height, maxHeight, file, layout, reporter } = args

  // check that all dimensions provided are positive
  const userDimensions = { width, maxWidth, height, maxHeight }
  const erroneousUserDimensions = Object.entries(userDimensions).filter(
    ([_, size]) => typeof size === `number` && size < 1
  )
  if (erroneousUserDimensions.length) {
    throw new Error(
      `Specified dimensions for images must be positive numbers (> 0). Problem dimensions you have are ${erroneousUserDimensions
        .map(dim => dim.join(`: `))
        .join(`, `)}`
    )
  }

  if (layout === `fixed`) {
    return fixedImageSizes(args)
  } else if (layout === `fluid` || layout === `constrained`) {
    return fluidImageSizes(args)
  } else {
    reporter.warn(
      `No valid layout was provided for the image at ${file.absolutePath}. Valid image layouts are fixed, fluid, and constrained.`
    )
    return []
  }
}
export function fixedImageSizes({
  file,
  imgDimensions,
  width,
  maxWidth,
  height,
  maxHeight,
  fit = `cover`,
  outputPixelDensities = DEFAULT_PIXEL_DENSITIES,
  srcSetBreakpoints,
  reporter,
}) {
  let sizes
  let aspectRatio = imgDimensions.width / imgDimensions.height
  // Sort, dedupe and ensure there's a 1
  const densities = dedupeAndSortDensities(outputPixelDensities)

  warnForIgnoredParameters(
    `fixed`,
    { maxWidth, maxHeight },
    file.absolutePath,
    reporter
  )

  // If both are provided then we need to check the fit
  if (width && height) {
    const calculated = getDimensionsAndAspectRatio(imgDimensions, {
      width,
      height,
      fit,
    })
    console.log({ calculated })
    width = calculated.width
    height = calculated.height
    aspectRatio = calculated.aspectRatio
  }

  if (!width && !height) {
    width = 400
  }

  // if no width is passed, we need to resize the image based on the passed height
  if (!width) {
    width = Math.round(height * aspectRatio)
  }

  sizes = densities
    .filter(size => size >= 1) // remove smaller densities because fixed images don't need them
    .map(density => Math.round(density * width))
    .filter(size => size <= imgDimensions.width)

  // If there's no fixed images after filtering (e.g. image is smaller than what's
  // requested, add back the original so there's at least something)
  if (sizes.length === 0) {
    sizes.push(width)
    const fixedDimension = width === undefined ? `height` : `width`
    reporter.warn(`
                     The requested ${fixedDimension} "${
      fixedDimension === `width` ? width : height
    }px" for a resolutions field for
                     the file ${file.absolutePath}
                     was larger than the actual image ${fixedDimension} of ${
      imgDimensions[fixedDimension]
    }px!
                     If possible, replace the current image with a larger one.
                     `)
  }
  return {
    sizes,
    aspectRatio,
    presentationWidth: width,
    presentationHeight: Math.round(width / aspectRatio),
  }
}

export function fluidImageSizes({
  file,
  imgDimensions,
  width,
  maxWidth,
  height,
  fit,
  maxHeight,
  outputPixelDensities = DEFAULT_PIXEL_DENSITIES,
  srcSetBreakpoints,
  reporter,
}) {
  // warn if ignored parameters are passed in
  warnForIgnoredParameters(
    `fluid and constrained`,
    { width, height },
    file.absolutePath,
    reporter
  )
  let sizes
  let aspectRatio = imgDimensions.width / imgDimensions.height
  // Sort, dedupe and ensure there's a 1
  const densities = dedupeAndSortDensities(outputPixelDensities)

  // If both are provided then we need to check the fit
  if (maxWidth && maxHeight) {
    const calculated = getDimensionsAndAspectRatio(imgDimensions, {
      width: maxWidth,
      height: maxHeight,
      fit,
    })
    maxWidth = calculated.width
    maxHeight = calculated.height
    aspectRatio = calculated.aspectRatio
  }

  // Case 1: maxWidth of maxHeight were passed in, make sure it isn't larger than the actual image
  maxWidth = maxWidth && Math.min(maxWidth, imgDimensions.width)
  maxHeight = maxHeight && Math.min(maxHeight, imgDimensions.height)

  // Case 2: neither maxWidth or maxHeight were passed in, use default size
  if (!maxWidth && !maxHeight) {
    maxWidth = Math.min(DEFAULT_FLUID_SIZE, imgDimensions.width)
    maxHeight = maxWidth / aspectRatio
  }

  // if it still hasn't been found, calculate maxWidth from the derived maxHeight
  if (!maxWidth) {
    maxWidth = maxHeight * aspectRatio
  }

  maxWidth = Math.round(maxWidth)

  // Create sizes (in width) for the image if no custom breakpoints are
  // provided. If the max width of the container for the rendered markdown file
  // is 800px, the sizes would then be: 200, 400, 800, 1600 if using
  // the default outputPixelDensities
  //
  // This is enough sizes to provide close to the optimal image size for every
  // device size / screen resolution while (hopefully) not requiring too much
  // image processing time (Sharp has optimizations thankfully for creating
  // multiple sizes of the same input file)
  if (srcSetBreakpoints) {
    sizes = srcSetBreakpoints.filter(size => size <= imgDimensions.width)
  } else {
    sizes = densities.map(density => Math.round(density * maxWidth))
    sizes = sizes.filter(size => size <= imgDimensions.width)
  }

  // ensure that the size passed in is included in the final output
  if (!sizes.includes(maxWidth)) {
    sizes.push(maxWidth)
  }
  sizes = sizes.sort((a, b) => a - b)
  return {
    sizes,
    aspectRatio,
    presentationWidth: maxWidth,
    presentationHeight: Math.round(maxWidth / aspectRatio),
  }
}

export const getSizes = width => `(max-width: ${width}px) 100vw, ${width}px`

export const getSrcSet = images =>
  images.map(image => `${image.src} ${image.width}w`).join(`\n`)

export function getDimensionsAndAspectRatio(dimensions, options) {
  // Calculate the eventual width/height of the image.
  const imageAspectRatio = dimensions.width / dimensions.height

  let width = options.width
  let height = options.height

  switch (options.fit) {
    case sharp.fit.fill: {
      width = options.width ? options.width : dimensions.width
      height = options.height ? options.height : dimensions.height
      break
    }
    case sharp.fit.inside: {
      const widthOption = options.width
        ? options.width
        : Number.MAX_SAFE_INTEGER
      const heightOption = options.height
        ? options.height
        : Number.MAX_SAFE_INTEGER

      width = Math.min(widthOption, Math.round(heightOption * imageAspectRatio))
      height = Math.min(
        heightOption,
        Math.round(widthOption / imageAspectRatio)
      )
      break
    }
    case sharp.fit.outside: {
      const widthOption = options.width ? options.width : 0
      const heightOption = options.height ? options.height : 0

      width = Math.max(widthOption, Math.round(heightOption * imageAspectRatio))
      height = Math.max(
        heightOption,
        Math.round(widthOption / imageAspectRatio)
      )
      break
    }

    default: {
      if (options.width && !options.height) {
        width = options.width
        height = Math.round(options.width / imageAspectRatio)
      }

      if (options.height && !options.width) {
        width = Math.round(options.height * imageAspectRatio)
        height = options.height
      }
    }
  }

  return {
    width,
    height,
    aspectRatio: width / height,
  }
}
