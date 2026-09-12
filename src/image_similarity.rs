use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io;
use std::path::Path;

use image::imageops::FilterType;
use sha1::{Digest, Sha1};

use crate::state::StateStore;

const GRID_SIZE: usize = 4;
const HSV_BINS: usize = 12 * 3 * 3;
const HISTOGRAM_SIZE: usize = GRID_SIZE * GRID_SIZE * HSV_BINS;
const EDGE_BINS: usize = 8;
const FEATURE_FORMAT: u8 = 1;

#[derive(Clone)]
struct Feature {
    hash: u64,
    histogram: [f32; HISTOGRAM_SIZE],
    edges: [f32; EDGE_BINS],
    aspect_ratio: f32,
}

#[cfg(test)]
pub(crate) fn order(directory: &Path, state: &StateStore) -> io::Result<Vec<String>> {
    order_with_access(directory, state, &crate::sharing::Access::default())
}

pub(crate) fn order_with_access(
    directory: &Path,
    state: &StateStore,
    access: &crate::sharing::Access,
) -> io::Result<Vec<String>> {
    let mut images = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if !access.allows(&path) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) if metadata.is_file() && super::is_image_file(&path) => metadata,
            _ => continue,
        };
        images.push((
            entry.file_name().to_string_lossy().into_owned(),
            path,
            format!("2:{}", super::file_version(&metadata)),
        ));
    }
    images.sort_by(|left, right| left.0.cmp(&right.0));
    let mut digest = Sha1::new();
    for (name, _, version) in &images {
        digest.update(name.as_bytes());
        digest.update([0]);
        digest.update(version.as_bytes());
        digest.update([0]);
    }
    let directory_version = crate::image_cache::hex_digest(&digest.finalize());
    if let Some(order) = state.image_similarity_order(directory, &directory_version)? {
        if let Ok(order) = serde_json::from_str(&order) {
            return Ok(order);
        }
    }

    let worker_count = std::thread::available_parallelism()
        .map_or(1, usize::from)
        .min(images.len().max(1));
    let chunk_size = images.len().div_ceil(worker_count);
    let mut featured = Vec::new();
    std::thread::scope(|scope| {
        let handles = images
            .chunks(chunk_size.max(1))
            .map(|chunk| {
                scope.spawn(move || {
                    chunk
                        .iter()
                        .filter_map(|(name, path, version)| {
                            feature(path, version, state)
                                .ok()
                                .map(|feature| (name.clone(), feature))
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            featured.extend(handle.join().unwrap());
        }
    });

    let mut ordered = cluster(&featured);
    for (name, _, _) in images {
        if !ordered.contains(&name) {
            ordered.push(name);
        }
    }
    state.set_image_similarity_order(
        directory,
        &directory_version,
        &serde_json::to_string(&ordered).map_err(io::Error::other)?,
    )?;
    Ok(ordered)
}

fn feature(path: &Path, source_version: &str, state: &StateStore) -> io::Result<Feature> {
    if let Some(bytes) = state.image_similarity_feature(path, source_version)? {
        if let Some(feature) = decode_feature(&bytes) {
            return Ok(feature);
        }
    }

    let image = image::open(path).map_err(io::Error::other)?;
    let aspect_ratio = image.width() as f32 / image.height().max(1) as f32;
    let grayscale = image
        .resize_exact(32, 32, FilterType::Triangle)
        .into_luma8();
    let hash = perceptual_hash(&grayscale);
    let pixels = image.resize_exact(64, 64, FilterType::Triangle);
    let histogram = spatial_hsv_histogram(&pixels.to_rgb8());
    let edges = edge_histogram(&pixels.to_luma8());
    let feature = Feature {
        hash,
        histogram,
        edges,
        aspect_ratio,
    };
    state.set_image_similarity_feature(path, source_version, &encode_feature(&feature))?;
    Ok(feature)
}

fn perceptual_hash(grayscale: &image::GrayImage) -> u64 {
    let mut coefficients = [0f32; 64];
    for v in 0..8 {
        for u in 0..8 {
            let mut coefficient = 0.0;
            for y in 0..32 {
                for x in 0..32 {
                    let pixel = grayscale.get_pixel(x, y)[0] as f32;
                    coefficient += pixel
                        * ((2 * x + 1) as f32 * u as f32 * std::f32::consts::PI / 64.0).cos()
                        * ((2 * y + 1) as f32 * v as f32 * std::f32::consts::PI / 64.0).cos();
                }
            }
            coefficients[v as usize * 8 + u as usize] = coefficient;
        }
    }
    let mut values = coefficients[1..].to_vec();
    values.sort_by(f32::total_cmp);
    let median = values[values.len() / 2];
    coefficients
        .iter()
        .enumerate()
        .skip(1)
        .fold(0u64, |hash, (index, value)| {
            hash | (u64::from(*value > median) << index)
        })
}

fn spatial_hsv_histogram(pixels: &image::RgbImage) -> [f32; HISTOGRAM_SIZE] {
    let mut histogram = [0f32; HISTOGRAM_SIZE];
    for (x, y, pixel) in pixels.enumerate_pixels() {
        let [r, g, b] = pixel.0.map(|value| value as f32 / 255.0);
        let maximum = r.max(g).max(b);
        let minimum = r.min(g).min(b);
        let delta = maximum - minimum;
        let hue = if delta == 0.0 {
            0.0
        } else if maximum == r {
            ((g - b) / delta).rem_euclid(6.0) / 6.0
        } else if maximum == g {
            ((b - r) / delta + 2.0) / 6.0
        } else {
            ((r - g) / delta + 4.0) / 6.0
        };
        let saturation = if maximum == 0.0 { 0.0 } else { delta / maximum };
        let hue_bin = (hue * 12.0).floor().min(11.0) as usize;
        let saturation_bin = (saturation * 3.0).floor().min(2.0) as usize;
        let value_bin = (maximum * 3.0).floor().min(2.0) as usize;
        let cell = y as usize / 16 * GRID_SIZE + x as usize / 16;
        histogram[cell * HSV_BINS + (hue_bin * 3 + saturation_bin) * 3 + value_bin] += 1.0;
    }
    for value in &mut histogram {
        *value /= 16.0 * 16.0;
    }
    histogram
}

fn edge_histogram(grayscale: &image::GrayImage) -> [f32; EDGE_BINS] {
    let mut edges = [0f32; EDGE_BINS];
    for y in 1..63 {
        for x in 1..63 {
            let sample = |x, y| grayscale.get_pixel(x, y)[0] as f32;
            let gx = -sample(x - 1, y - 1) + sample(x + 1, y - 1) - 2.0 * sample(x - 1, y)
                + 2.0 * sample(x + 1, y)
                - sample(x - 1, y + 1)
                + sample(x + 1, y + 1);
            let gy = -sample(x - 1, y - 1) - 2.0 * sample(x, y - 1) - sample(x + 1, y - 1)
                + sample(x - 1, y + 1)
                + 2.0 * sample(x, y + 1)
                + sample(x + 1, y + 1);
            let magnitude = gx.hypot(gy);
            let angle = gy.atan2(gx).rem_euclid(std::f32::consts::PI);
            let bin = (angle / std::f32::consts::PI * EDGE_BINS as f32)
                .floor()
                .min((EDGE_BINS - 1) as f32) as usize;
            edges[bin] += magnitude;
        }
    }
    let total = edges.iter().sum::<f32>();
    if total > 0.0 {
        for value in &mut edges {
            *value /= total;
        }
    }
    edges
}

fn distance(left: &Feature, right: &Feature) -> f32 {
    let hash = (left.hash ^ right.hash).count_ones() as f32 / 63.0;
    let histogram = left
        .histogram
        .iter()
        .zip(right.histogram.iter())
        .map(|(left, right)| (left - right).abs())
        .sum::<f32>()
        / (GRID_SIZE * GRID_SIZE) as f32
        / 2.0;
    let edges = left
        .edges
        .iter()
        .zip(right.edges.iter())
        .map(|(left, right)| (left - right).abs())
        .sum::<f32>()
        / 2.0;
    let aspect_ratio = ((left.aspect_ratio / right.aspect_ratio).ln().abs() / 4.0f32.ln()).min(1.0);
    hash * 0.35 + histogram * 0.35 + edges * 0.20 + aspect_ratio * 0.10
}

fn cluster(images: &[(String, Feature)]) -> Vec<String> {
    if images.len() < 2 {
        return images.iter().map(|(name, _)| name.clone()).collect();
    }
    let mut nearest = vec![Vec::new(); images.len()];
    for left in 0..images.len() {
        let mut neighbours = (0..images.len())
            .filter(|right| *right != left)
            .map(|right| (right, distance(&images[left].1, &images[right].1)))
            .collect::<Vec<_>>();
        neighbours.sort_by(|left, right| left.1.total_cmp(&right.1));
        nearest[left] = neighbours.into_iter().take(4).collect();
    }

    let mut groups = Groups::new(images.len());
    for left in 0..images.len() {
        for &(right, separation) in &nearest[left] {
            let mutual = nearest[right].iter().any(|(index, _)| *index == left);
            if separation <= 0.18 || mutual && separation <= 0.42 {
                groups.join(left, right);
            }
        }
    }
    let mut components = HashMap::<usize, Vec<usize>>::new();
    for index in 0..images.len() {
        components
            .entry(groups.root(index))
            .or_default()
            .push(index);
    }
    let mut components = components.into_values().collect::<Vec<_>>();
    components.sort_by_key(|component| component.iter().copied().min().unwrap());

    let representatives = components
        .iter()
        .enumerate()
        .map(|(component_index, component)| {
            let medoid = component
                .iter()
                .copied()
                .min_by(|left, right| {
                    component
                        .iter()
                        .map(|index| distance(&images[*left].1, &images[*index].1))
                        .sum::<f32>()
                        .total_cmp(
                            &component
                                .iter()
                                .map(|index| distance(&images[*right].1, &images[*index].1))
                                .sum::<f32>(),
                        )
                })
                .unwrap();
            (component_index.to_string(), images[medoid].1.clone())
        })
        .collect::<Vec<_>>();

    chain(&representatives)
        .into_iter()
        .flat_map(|component_index| {
            let component = &components[component_index.parse::<usize>().unwrap()];
            let members = component
                .iter()
                .map(|index| images[*index].clone())
                .collect::<Vec<_>>();
            chain(&members)
        })
        .collect()
}

fn chain(images: &[(String, Feature)]) -> Vec<String> {
    match images.len() {
        0 => return Vec::new(),
        1 => return vec![images[0].0.clone()],
        _ => {}
    }
    let mut closest = (0, 1, distance(&images[0].1, &images[1].1));
    for left in 0..images.len() {
        for right in left + 1..images.len() {
            let candidate = distance(&images[left].1, &images[right].1);
            if candidate < closest.2 {
                closest = (left, right, candidate);
            }
        }
    }
    let mut chain = VecDeque::from([closest.0, closest.1]);
    let mut unused = (0..images.len())
        .filter(|index| *index != closest.0 && *index != closest.1)
        .collect::<Vec<_>>();
    while !unused.is_empty() {
        let first = *chain.front().unwrap();
        let last = *chain.back().unwrap();
        let mut best = (0, true, f32::MAX);
        for (position, index) in unused.iter().copied().enumerate() {
            for (front, neighbour) in [(true, first), (false, last)] {
                let candidate = distance(&images[index].1, &images[neighbour].1);
                if candidate < best.2 {
                    best = (position, front, candidate);
                }
            }
        }
        let index = unused.swap_remove(best.0);
        if best.1 {
            chain.push_front(index);
        } else {
            chain.push_back(index);
        }
    }
    chain
        .into_iter()
        .map(|index| images[index].0.clone())
        .collect()
}

fn encode_feature(feature: &Feature) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(1 + 8 + 4 * (1 + HISTOGRAM_SIZE + EDGE_BINS));
    bytes.push(FEATURE_FORMAT);
    bytes.extend_from_slice(&feature.hash.to_le_bytes());
    bytes.extend_from_slice(&feature.aspect_ratio.to_le_bytes());
    for value in feature.histogram.iter().chain(feature.edges.iter()) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_feature(bytes: &[u8]) -> Option<Feature> {
    let expected = 1 + 8 + 4 * (1 + HISTOGRAM_SIZE + EDGE_BINS);
    if bytes.len() != expected || bytes[0] != FEATURE_FORMAT {
        return None;
    }
    let hash = u64::from_le_bytes(bytes[1..9].try_into().ok()?);
    let aspect_ratio = f32::from_le_bytes(bytes[9..13].try_into().ok()?);
    let mut values = bytes[13..]
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()));
    let mut histogram = [0.0; HISTOGRAM_SIZE];
    for value in &mut histogram {
        *value = values.next()?;
    }
    let mut edges = [0.0; EDGE_BINS];
    for value in &mut edges {
        *value = values.next()?;
    }
    Some(Feature {
        hash,
        histogram,
        edges,
        aspect_ratio,
    })
}

struct Groups(Vec<usize>);

impl Groups {
    fn new(size: usize) -> Self {
        Self((0..size).collect())
    }

    fn root(&mut self, index: usize) -> usize {
        if self.0[index] != index {
            self.0[index] = self.root(self.0[index]);
        }
        self.0[index]
    }

    fn join(&mut self, left: usize, right: usize) {
        let left = self.root(left);
        let right = self.root(right);
        self.0[right] = left;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_visually_similar_images_adjacent_and_caches_features() {
        let directory = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        image::RgbImage::from_pixel(32, 32, image::Rgb([240, 30, 30]))
            .save(directory.path().join("red.png"))
            .unwrap();
        image::RgbImage::from_pixel(32, 32, image::Rgb([220, 35, 35]))
            .save(directory.path().join("red-dark.png"))
            .unwrap();
        image::RgbImage::from_pixel(32, 32, image::Rgb([20, 30, 240]))
            .save(directory.path().join("blue.png"))
            .unwrap();
        let state = StateStore::new(Some(cache.path())).unwrap();

        let ordered = order(directory.path(), &state).unwrap();
        let first = ordered.iter().position(|name| name == "red.png").unwrap();
        let second = ordered
            .iter()
            .position(|name| name == "red-dark.png")
            .unwrap();
        assert_eq!(first.abs_diff(second), 1);

        drop(state);
        fs::remove_file(directory.path().join("red.png")).unwrap();
        let connection = rusqlite::Connection::open(cache.path().join("webdir.sqlite")).unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM image_similarity_features",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }
}
