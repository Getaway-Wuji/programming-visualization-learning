#include <iostream>
int partition(int a[], int left, int right) {
    int pivot = a[right];
    int small = left;
    for (int i = left; i < right; i = i + 1) {
        if (a[i] <= pivot) {
            int temporary = a[i];
            a[i] = a[small];
            a[small] = temporary;
            small = small + 1;
        }
    }
    int temporary = a[small];
    a[small] = a[right];
    a[right] = temporary;
    return small;
}
void quicksort(int a[], int left, int right) {
    if (left >= right) { return; }
    int pivot = partition(a, left, right);
    quicksort(a, left, pivot - 1);
    quicksort(a, pivot + 1, right);
}
int main() {
    int a[5];
    for (int i = 0; i < 5; i = i + 1) { std::cin >> a[i]; }
    quicksort(a, 0, 4);
    for (int i = 0; i < 5; i = i + 1) { std::cout << a[i] << " "; }
    std::cout << std::endl;
    return 0;
}
