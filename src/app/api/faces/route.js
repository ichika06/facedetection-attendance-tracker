import supabase from "@/lib/supabase";

export async function GET() {
  try {
    const bucketName = "Attendancetracking";
    const folderPath = "faces/";

    // Fetch list of images in the `faces` folder
    const { data, error } = await supabase.storage.from(bucketName).list(folderPath, {
      limit: 100, // Adjust based on your needs
      offset: 0,
    });

    if (error) throw error;

    // Generate public URLs for images
    const imageUrls = data
      .filter((file) => file.name.endsWith(".jpg") || file.name.endsWith(".png"))
      .map((file) =>
        supabase.storage.from(bucketName).getPublicUrl(`${folderPath}${file.name}`).data.publicUrl
      );

    return Response.json({ faces: imageUrls });
  } catch (error) {
    return Response.json({ error: "Failed to load face images" }, { status: 500 });
  }
}
